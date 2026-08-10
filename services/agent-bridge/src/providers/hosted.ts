import { validateSairiUI } from '@sairios/adaptive-ui-schema';
import { isCapability } from '@sairios/context-schema';
import { fail, newId, ok, type Result } from '@sairios/shared';
import type { AgentEvent, AgentProvider, IntentionInput, ProviderStatus } from '../provider.js';

/**
 * The hosted SairiOS gateway.
 *
 * ---------------------------------------------------------------------------
 * What problem this solves, and the one it must not create
 * ---------------------------------------------------------------------------
 * A first run that opens a setup wizard and then runs a deterministic mock
 * agent is a weak introduction to an operating system. The obvious fix — ship a
 * provider key in the image so it "just works" — is forbidden here, and rightly:
 * a key in a qcow2 layer is extractable by anyone who gets the image, is billed
 * to whoever owns it, and cannot be rotated without reshipping. See invariant 8
 * and ADR 0010.
 *
 * So the key lives on a server SairiOS operates, and an instance holds only a
 * token that identifies IT. Losing an instance token costs that instance's
 * quota; losing a provider key costs the account. That asymmetry is the whole
 * design.
 *
 * ---------------------------------------------------------------------------
 * This is the first outbound connection SairiOS makes on its own
 * ---------------------------------------------------------------------------
 * Every previous version talked only to loopback. `network.fetch` is still
 * simulated precisely so that no egress happens on an AGENT's behalf — that has
 * not changed, and must not. What changed is that the SYSTEM now calls out when
 * this provider is selected, which is a posture change large enough that
 * SECURITY.md records it rather than leaving it implicit in a provider file.
 *
 * It is opt-in: `SAIRIOS_AGENT_PROVIDER=hosted`. Nothing here runs otherwise,
 * and mock mode remains the credential-free default that invariant 6 requires.
 *
 * ---------------------------------------------------------------------------
 * THE WIRE CONTRACT — this endpoint does not exist yet
 * ---------------------------------------------------------------------------
 * Written down here because the client is being built before the server, and a
 * contract that lives only in one implementation is not a contract.
 *
 *   POST {gatewayUrl}/v1/turns
 *   Authorization: Bearer {instanceToken}
 *   Content-Type: application/json
 *   Accept: application/x-ndjson
 *
 *   { "contextId", "contextType", "contextName", "intention" }
 *
 * The response is NDJSON, one JSON object per line, each shaped like the
 * `AgentEvent` union the bridge already normalises:
 *
 *   {"type":"status","status":"thinking"}
 *   {"type":"message","text":"…"}
 *   {"type":"permission-request","capability":"files.read","reason":"…","payload":{}}
 *   {"type":"ui","document":{…}}
 *   {"type":"error","message":"…","recoverable":false}
 *   {"type":"done"}
 *
 * **The server owns the prompt contract.** It is responsible for instructing a
 * model to emit a SairiUI document and for handing back something shaped like
 * one. That belongs server-side rather than in the guest: the prompt will need
 * changing far more often than the VM image should be reshipped, and every
 * instance benefits at once.
 *
 * The client still validates. A hosted server is not a trusted source — it is
 * simply a source SairiOS happens to run — so a document that fails validation
 * is rejected here exactly as one from any other provider would be. Invariant 4
 * has no exception for first-party infrastructure.
 */

export interface HostedOptions {
  /** Base URL of the hosted gateway. Must be https off loopback. */
  gatewayUrl: string;
  /** Identifies this instance. NOT a provider credential. */
  instanceToken: string | undefined;
  requestTimeoutMs?: number;
  /** Injectable so the lifecycle is testable without a server. */
  fetchImpl?: typeof fetch;
}

/**
 * Refuses to send an instance token over plaintext.
 *
 * A bearer token on plain http is readable by anything on the path, and the
 * mistake is silent — it works, so nobody notices. Loopback is exempt because
 * there is no path to be on, which is what makes local development possible
 * without weakening the rule for everyone else.
 */
export function transportIsSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === 'localhost'
    );
  } catch {
    return false;
  }
}

/**
 * One NDJSON line to an AgentEvent, or nothing.
 *
 * Everything arriving here is untrusted, so the shape is checked field by
 * field rather than cast. A malformed line is dropped rather than thrown on:
 * one bad frame in a stream should not lose the frames after it, and a stream
 * that dies mid-turn leaves the user with no interface and no explanation.
 */
export function decodeHostedEvent(line: string): AgentEvent | undefined {
  let frame: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    frame = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  switch (frame['type']) {
    case 'status': {
      const status = frame['status'];
      return status === 'thinking' ||
        status === 'streaming' ||
        status === 'waiting-permission' ||
        status === 'idle'
        ? { type: 'status', status }
        : undefined;
    }

    case 'message':
      return typeof frame['text'] === 'string'
        ? { type: 'message', text: frame['text'] }
        : undefined;

    case 'permission-request': {
      // The capability is checked against the closed set here rather than
      // trusted, so a server cannot invent one and have the broker meet a name
      // it has no policy for.
      const capability = frame['capability'];
      if (typeof capability !== 'string' || !isCapability(capability)) return undefined;
      return {
        type: 'permission-request',
        capability,
        reason: typeof frame['reason'] === 'string' ? frame['reason'] : '',
        payload: frame['payload'],
      };
    }

    case 'ui': {
      // Validated here, not merely forwarded. A first-party server is still a
      // source of untrusted input; the bridge validates again after this, and
      // that redundancy is deliberate (invariant 4).
      const result = validateSairiUI(frame['document']);
      return result.ok
        ? { type: 'ui', document: result.value }
        : {
            type: 'ui-rejected',
            reason: 'the hosted gateway returned a document that failed validation',
            messages: result.error.messages.slice(0, 8),
          };
    }

    case 'error':
      return {
        type: 'error',
        message: typeof frame['message'] === 'string' ? frame['message'] : 'the gateway failed',
        recoverable: frame['recoverable'] === true,
      };

    case 'done':
      return { type: 'done' };

    default:
      return undefined;
  }
}

export class HostedAgentProvider implements AgentProvider {
  readonly name = 'hosted';
  readonly #options: HostedOptions;

  constructor(options: HostedOptions) {
    this.#options = options;
  }

  async status(): Promise<ProviderStatus> {
    if (!this.#options.instanceToken) {
      return {
        provider: 'hosted',
        configured: false,
        offline: false,
        detail:
          'The hosted gateway is selected but SAIRIOS_INSTANCE_TOKEN is empty. This instance ' +
          'cannot identify itself, so no turn can run.',
      };
    }
    if (!transportIsSafe(this.#options.gatewayUrl)) {
      return {
        provider: 'hosted',
        configured: false,
        offline: false,
        detail:
          `Refusing to send an instance token to ${this.#options.gatewayUrl} over plaintext. ` +
          'Use https, or a loopback address for local development.',
      };
    }
    return {
      provider: 'hosted',
      configured: true,
      offline: false,
      detail:
        `Hosted inference at ${this.#options.gatewayUrl}. The model runs on SairiOS ` +
        'infrastructure and this instance holds no provider credential. SCAFFOLDING: the ' +
        'endpoint described in providers/hosted.ts has not been built or contacted.',
    };
  }

  async createSession(_contextId: string): Promise<Result<string>> {
    const status = await this.status();
    if (!status.configured) return fail('provider_not_configured', status.detail);
    // Stateless: the server keys a turn on the context, so there is nothing to
    // create. A local id keeps the bridge's session bookkeeping intact without
    // implying a remote resource that does not exist.
    return ok(newId('ses'));
  }

  async *run(_sessionId: string, input: IntentionInput): AsyncIterable<AgentEvent> {
    const status = await this.status();
    if (!status.configured) {
      // Never a fabricated document. A user who selected the hosted provider
      // must not be shown mock output dressed as a model's work.
      yield { type: 'error', message: status.detail, recoverable: false };
      yield { type: 'done' };
      return;
    }

    const doFetch = this.#options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.requestTimeoutMs ?? 120_000);

    try {
      const response = await doFetch(`${trimEnd(this.#options.gatewayUrl)}/v1/turns`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#options.instanceToken ?? ''}`,
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          contextId: input.contextId,
          contextType: input.contextType,
          contextName: input.contextName,
          intention: input.intention,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        yield {
          type: 'error',
          message: `The hosted gateway answered ${response.status}.`,
          // 5xx and 429 are worth retrying; a 401 will fail identically forever.
          recoverable: response.status >= 500 || response.status === 429,
        };
        yield { type: 'done' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            const event = decodeHostedEvent(line);
            if (event) {
              yield event;
              if (event.type === 'done') sawDone = true;
            }
          }
          newline = buffer.indexOf('\n');
        }
      }

      // A stream that ends without `done` was cut off. Saying so beats leaving
      // the shell showing an agent that never finishes.
      if (!sawDone) {
        yield {
          type: 'error',
          message: 'The hosted gateway closed the stream before the turn finished.',
          recoverable: true,
        };
        yield { type: 'done' };
      }
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      yield {
        type: 'error',
        message: aborted
          ? 'The hosted gateway did not answer in time.'
          : `Could not reach the hosted gateway: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
        recoverable: true,
      };
      yield { type: 'done' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Nothing to close. Each turn is one request; the server holds no session for
   * this client to release, so there is no remote resource to tidy and nothing
   * to report if there were.
   */
  async closeSession(_sessionId: string): Promise<void> {
    return;
  }
}

function trimEnd(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
