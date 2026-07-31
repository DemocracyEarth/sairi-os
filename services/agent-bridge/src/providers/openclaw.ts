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
 * Placeholder wire codec.
 *
 * UNVERIFIED against a live gateway. Isolated here so reconciling it with the
 * real OpenClaw protocol touches one function in each direction.
 */
const codec = {
  encodeIntention(sessionId: string, input: IntentionInput): string {
    return JSON.stringify({
      type: 'session.prompt',
      sessionId,
      prompt: input.intention,
      metadata: {
        contextId: input.contextId,
        contextType: input.contextType,
        contextName: input.contextName,
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

    switch (frame['type']) {
      case 'session.created':
        return typeof frame['sessionId'] === 'string'
          ? [{ type: 'session', sessionId: frame['sessionId'] }]
          : [];

      case 'message.delta':
      case 'message':
        return typeof frame['text'] === 'string' ? [{ type: 'message', text: frame['text'] }] : [];

      case 'tool.call': {
        const capability = frame['capability'];
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
            reason: String(frame['reason'] ?? 'No reason given.'),
            payload: frame['payload'] ?? {},
          },
        ];
      }

      case 'ui.specification': {
        // Model output. Validated before it can reach the renderer.
        const validated = validateSairiUI(frame['document']);
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

      case 'session.error':
        return [
          {
            type: 'error',
            message: String(frame['message'] ?? 'Gateway error.'),
            recoverable: false,
          },
        ];

      case 'session.done':
        return [{ type: 'done' }];

      default:
        // Unknown frame types are ignored rather than surfaced, so a newer
        // gateway adding a frame does not break the session.
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
