import { readFile } from 'node:fs/promises';
import { validateSairiUI } from '@sairios/adaptive-ui-schema';
import { isCapability } from '@sairios/context-schema';
import { fail, newId, ok, type Result } from '@sairios/shared';
import type { AgentEvent, AgentProvider, IntentionInput, ProviderStatus } from '../provider.js';

/**
 * OpenClaw provider — SCAFFOLDING, NOT VERIFIED.
 *
 * Status, stated plainly so nobody is misled:
 *
 *   This file has never been run against a live OpenClaw Gateway. The
 *   connection lifecycle (configuration, dial, timeout, teardown, error
 *   reporting) is real and exercised by tests. The WIRE MESSAGES in `codec`
 *   below are a placeholder shape and MUST be reconciled against the pinned
 *   OpenClaw version in openclaw/config/version.json before this provider is
 *   claimed to work.
 *
 * What is deliberately correct already:
 *   - SairiOS never authenticates to a model provider. Credentials belong to
 *     OpenClaw's own configuration. This provider carries a gateway token only.
 *   - Every payload arriving from the gateway is untrusted: SairiUI documents
 *     are validated here before they can become a `ui` event, and capability
 *     names are checked against the known set before becoming a permission
 *     request.
 *   - Failure is reported as an `error` event. It never silently falls back to
 *     the mock provider, because a user who selected `openclaw` must not be
 *     shown fabricated output.
 */

export interface OpenClawOptions {
  gatewayUrl: string;
  gatewayToken: string | undefined;
  /** Path to openclaw/config/version.json for the pin check. */
  versionFile?: string;
  connectTimeoutMs?: number;
  /** Injectable transport so the lifecycle can be tested without a gateway. */
  transport?: GatewayTransport;
}

/** Minimal transport seam. The default implementation uses `ws`. */
export interface GatewayTransport {
  connect(url: string, headers: Record<string, string>, timeoutMs: number): Promise<GatewaySocket>;
}

export interface GatewaySocket {
  send(payload: string): void;
  /** Resolves once the socket closes. Yields raw text frames until then. */
  messages(): AsyncIterable<string>;
  close(): void;
}

/**
 * Wire codec for the OpenClaw gateway, protocol 4.
 *
 * The envelope and the handshake are VERIFIED against a live gateway
 * (openclaw 2026.7.1-2, 2026-08-03). Real captured frames are in
 * ./gateway-frames.fixture.json and are what the tests run on.
 *
 * The session flow below is NOT verified: running a turn needs a configured
 * model provider, which needs somebody's API key. The method and event names
 * used are the ones the live gateway advertised in `hello-ok.features`, so they
 * exist — but the request params and the event payload shapes are still read
 * from upstream types rather than observed.
 *
 * What the earlier placeholder got wrong, and why it could never have worked:
 * it switched on `frame.type` expecting an event NAME there. In the real
 * protocol `type` is one of three CATEGORIES — req, res, event — and the name
 * lives in `event` (or `method`). Every invented name it looked for
 * (`session.prompt`, `session.created`, `message.delta`, `tool.call`,
 * `ui.specification`, `session.done`) is absent from the 218 methods and 30
 * events the gateway actually offers.
 */

/** Protocol version this client speaks. The gateway echoes it in hello-ok. */
export const GATEWAY_PROTOCOL = 4;

/**
 * Identity for the connect handshake.
 *
 * `client.id` and `client.mode` are closed enums enforced server-side; anything
 * else is refused with INVALID_REQUEST naming the offending path. SairiOS uses
 * the documented trusted same-process backend path — a loopback control-plane
 * client, which may omit `device` instead of going through pairing.
 *
 * `mode` is NOT `operator`. That is a ROLE. The protocol.md shipped inside the
 * openclaw package itself shows `"mode": "operator"` in its connect example and
 * the gateway rejects it; upstream's doc is wrong.
 */
export const CLIENT_IDENTITY = {
  id: 'gateway-client',
  mode: 'backend',
  platform: 'linux',
} as const;

/** Builds the `connect` request sent in reply to `connect.challenge`. */
export function encodeConnect(id: string, version: string, token?: string): string {
  return JSON.stringify({
    type: 'req',
    id,
    method: 'connect',
    params: {
      minProtocol: GATEWAY_PROTOCOL,
      maxProtocol: GATEWAY_PROTOCOL,
      client: { ...CLIENT_IDENTITY, version },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      locale: 'en-US',
      userAgent: `sairios-agent-bridge/${version}`,
      ...(token ? { auth: { token } } : {}),
    },
  });
}

/** True for the pre-connect challenge the gateway sends before anything else. */
export function isConnectChallenge(frame: Record<string, unknown>): boolean {
  return frame['type'] === 'event' && frame['event'] === 'connect.challenge';
}
const codec = {
  /**
   * `sessions.send` is a real method — it is in the vocabulary the live gateway
   * advertised. The params shape is not yet observed; see the file header.
   */
  encodeIntention(sessionId: string, input: IntentionInput): string {
    return JSON.stringify({
      type: 'req',
      id: `send-${sessionId}`,
      method: 'sessions.send',
      params: {
        sessionId,
        message: input.intention,
        metadata: {
          contextId: input.contextId,
          contextType: input.contextType,
          contextName: input.contextName,
        },
      },
    });
  },

  /** Normalizes one gateway frame into zero or more SairiOS events. */
  decodeFrame(raw: string): AgentEvent[] {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return [
        { type: 'error', message: 'Gateway sent a frame that is not JSON.', recoverable: true },
      ];
    }

    // The real envelope. `type` is the CATEGORY; the name is in `event`.
    if (frame['type'] === 'res') {
      if (frame['ok'] === false) {
        const error = (frame['error'] ?? {}) as Record<string, unknown>;
        return [
          {
            type: 'error',
            message: `${String(error['code'] ?? 'GATEWAY_ERROR')}: ${String(
              error['message'] ?? 'The gateway refused the request.',
            )}`,
            recoverable: false,
          },
        ];
      }
      return [];
    }

    if (frame['type'] !== 'event') return [];

    const payload = (frame['payload'] ?? {}) as Record<string, unknown>;

    switch (frame['event']) {
      case 'session.message':
      case 'chat':
      case 'agent': {
        const text = payload['text'] ?? payload['content'];
        return typeof text === 'string' ? [{ type: 'message', text }] : [];
      }

      // OpenClaw runs its own approval round trip. SairiOS already has one, so
      // this becomes a broker request rather than a second prompt to the user.
      case 'exec.approval.requested': {
        const capability = payload['capability'];
        if (!isCapability(capability)) {
          return [
            {
              type: 'error',
              message: `Gateway requested an unknown capability: ${String(capability)}`,
              recoverable: true,
            },
          ];
        }
        return [
          {
            type: 'permission-request',
            capability,
            reason: String(payload['reason'] ?? 'No reason given.'),
            payload: payload['payload'] ?? {},
          },
        ];
      }

      case 'session.operation': {
        // A SairiUI document arrives as operation output. Validated before it
        // can reach the renderer, exactly as before — that part was never the
        // protocol's business.
        if (payload['kind'] !== 'ui') return [];
        const validated = validateSairiUI(payload['document']);
        return validated.ok
          ? [{ type: 'ui', document: validated.value }]
          : [
              {
                type: 'ui-rejected',
                reason: validated.error.reason,
                messages: validated.error.messages,
              },
            ];
      }

      case 'shutdown':
        return [{ type: 'done' }];

      default:
        // Unknown events are ignored rather than surfaced, so a newer gateway
        // adding one does not break the session.
        return [];
    }
  },
};

export class OpenClawAgentProvider implements AgentProvider {
  readonly name = 'openclaw';
  readonly #options: Required<Omit<OpenClawOptions, 'transport' | 'gatewayToken' | 'versionFile'>> &
    Pick<OpenClawOptions, 'transport' | 'gatewayToken' | 'versionFile'>;
  readonly #sockets = new Map<string, GatewaySocket>();

  constructor(options: OpenClawOptions) {
    this.#options = {
      gatewayUrl: options.gatewayUrl,
      gatewayToken: options.gatewayToken,
      connectTimeoutMs: options.connectTimeoutMs ?? 5000,
      ...(options.versionFile ? { versionFile: options.versionFile } : {}),
      ...(options.transport ? { transport: options.transport } : {}),
    };
  }

  async status(): Promise<ProviderStatus> {
    const pinned = await this.#pinnedVersion();
    if (!this.#options.gatewayToken) {
      return {
        provider: 'openclaw',
        configured: false,
        offline: false,
        detail:
          'OPENCLAW_GATEWAY_TOKEN is not set. Run OpenClaw onboarding (docs/OPENCLAW.md) or set ' +
          'SAIRIOS_AGENT_PROVIDER=mock to work offline.',
      };
    }
    return {
      provider: 'openclaw',
      configured: true,
      offline: false,
      detail:
        `Configured for ${this.#options.gatewayUrl}` +
        (pinned ? ` (pinned OpenClaw ${pinned})` : '') +
        '. SCAFFOLDING: the gateway wire protocol in this build has not been verified against a ' +
        'live OpenClaw Gateway.',
    };
  }

  async createSession(_contextId: string): Promise<Result<string>> {
    if (!this.#options.gatewayToken) {
      return fail('provider_not_configured', 'OpenClaw gateway token is not set.');
    }
    if (!this.#options.transport) {
      return fail(
        'transport_unavailable',
        'No gateway transport is wired in this build. See docs/OPENCLAW.md.',
      );
    }
    return ok(newId('ses'));
  }

  async *run(sessionId: string, input: IntentionInput): AsyncIterable<AgentEvent> {
    const status = await this.status();
    if (!status.configured) {
      yield { type: 'error', message: status.detail, recoverable: false };
      yield { type: 'done' };
      return;
    }
    if (!this.#options.transport) {
      yield {
        type: 'error',
        message:
          'The OpenClaw transport is not wired in this build. This provider is scaffolding: see ' +
          'docs/OPENCLAW.md for the exact steps to finish and verify the integration.',
        recoverable: false,
      };
      yield { type: 'done' };
      return;
    }

    let socket: GatewaySocket;
    try {
      socket = await this.#options.transport.connect(
        this.#options.gatewayUrl,
        { authorization: `Bearer ${this.#options.gatewayToken}` },
        this.#options.connectTimeoutMs,
      );
    } catch (cause) {
      yield {
        type: 'error',
        message: `Could not reach the OpenClaw Gateway at ${this.#options.gatewayUrl}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        recoverable: true,
      };
      yield { type: 'done' };
      return;
    }

    this.#sockets.set(sessionId, socket);
    yield { type: 'session', sessionId };
    yield { type: 'status', status: 'thinking' };

    try {
      socket.send(codec.encodeIntention(sessionId, input));
      for await (const frame of socket.messages()) {
        for (const event of codec.decodeFrame(frame)) {
          yield event;
          if (event.type === 'done') return;
        }
      }
      yield { type: 'done' };
    } catch (cause) {
      yield {
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        recoverable: true,
      };
      yield { type: 'done' };
    } finally {
      socket.close();
      this.#sockets.delete(sessionId);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    this.#sockets.get(sessionId)?.close();
    this.#sockets.delete(sessionId);
  }

  async #pinnedVersion(): Promise<string | undefined> {
    if (!this.#options.versionFile) return undefined;
    try {
      const raw = await readFile(this.#options.versionFile, 'utf8');
      const parsed = JSON.parse(raw) as { openclaw?: { version?: string } };
      return parsed.openclaw?.version;
    } catch {
      return undefined;
    }
  }
}

/** Exported for tests that assert normalization without a gateway. */
export const openclawCodec = codec;
