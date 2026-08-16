import { validateSairiUI } from '@sairios/adaptive-ui-schema';
import { createLogger, type Logger } from '@sairios/shared';
import type { BrokerClient, ContextClient } from './clients.js';
import { relayApproval } from './approval-relay.js';
import type { AgentEvent, AgentProvider, IntentionInput } from './provider.js';

/**
 * The agent bridge.
 *
 * Sits between the desktop shell and whichever provider is configured, and
 * owns three responsibilities the shell must not have:
 *
 *   1. Validation. A `ui` event is re-validated here even though providers
 *      validate too — defence in depth at the process boundary.
 *   2. Permission routing. A capability the agent asks for becomes a permission
 *      broker request. The bridge cannot grant anything; it can only ask.
 *   3. Persistence. UI documents and activity are written to the context
 *      service so a context survives a restart of the shell.
 */

export type BridgeEvent =
  | AgentEvent
  | {
      type: 'permission-pending';
      requestId: string;
      capability: string;
      reason: string;
      risk: string;
    };

export interface BridgeOptions {
  provider: AgentProvider;
  /** Additional agents a run may name. Closed set; see AgentBridge#others. */
  agents?: readonly AgentProvider[];
  broker: BrokerClient;
  contexts: ContextClient;
  logger?: Logger;
}

export class AgentBridge {
  readonly #provider: AgentProvider;
  /**
   * Other agents this bridge can run, by name.
   *
   * The first sliver of a registry. Until now the bridge held exactly one
   * provider chosen by an env var, which is the single largest structural gap
   * between what exists and an orchestrator: you cannot hand work between
   * agents when there is only ever one.
   *
   * A CLOSED map, resolved here. A run that names an agent this machine does
   * not know is refused rather than falling back to the default — the same
   * rule the relay applies to its destination, and for the same reason: a name
   * that arrives from outside must never select what runs.
   */
  readonly #others: ReadonlyMap<string, AgentProvider>;
  readonly #broker: BrokerClient;
  readonly #contexts: ContextClient;
  readonly #log: Logger;

  constructor(options: BridgeOptions) {
    this.#provider = options.provider;
    this.#others = new Map((options.agents ?? []).map((p) => [p.name, p]));
    this.#broker = options.broker;
    this.#contexts = options.contexts;
    this.#log = options.logger ?? createLogger('agent-bridge');
  }

  get providerName(): string {
    return this.#provider.name;
  }

  /** Every agent a run may name, the default first. */
  get agentNames(): string[] {
    return [this.#provider.name, ...this.#others.keys()];
  }

  status() {
    return this.#provider.status();
  }

  /**
   * Runs an intention and yields normalized events. Never throws: a provider
   * failure becomes an `error` event followed by `done`, so a caller streaming
   * to the UI always sees a terminated stream.
   */
  async *run(input: IntentionInput & { agent?: string }): AsyncIterable<BridgeEvent> {
    // The default provider unless a known agent is named. Unknown is an error,
    // never a silent fallback: a handover that quietly ran the wrong agent
    // would still look like it worked.
    let provider = this.#provider;
    if (input.agent && input.agent !== this.#provider.name) {
      const named = this.#others.get(input.agent);
      if (!named) {
        yield {
          type: 'error',
          message: `"${input.agent}" is not an agent this machine knows.`,
          recoverable: false,
        };
        yield { type: 'done' };
        return;
      }
      provider = named;
    }

    const session = await provider.createSession(input.contextId);
    if (!session.ok) {
      yield { type: 'error', message: session.error.message, recoverable: false };
      yield { type: 'done' };
      return;
    }

    await this.#contexts.appendEvent(
      input.contextId,
      'intention.submitted',
      input.intention.slice(0, 200),
    );

    try {
      for await (const event of provider.run(session.value, input)) {
        switch (event.type) {
          case 'permission-request': {
            // A provider that supplies an externalId is BLOCKING on our answer
            // — OpenClaw raises exec.approval.requested and waits. Those go
            // through the relay, which reaches a decision and sends it back, so
            // the user is asked once rather than twice.
            //
            // The relay is deliberately stricter than a local grant: OpenClaw
            // performs the action in its own process, outside the sandbox the
            // broker would otherwise contain it in. See approval-relay.ts.
            if (event.externalId && provider.resolveApproval) {
              const resolveApproval = provider.resolveApproval.bind(this.#provider);
              const externalId = event.externalId;
              const policy = await this.#broker.policy(event.capability);

              const outcome = await relayApproval(
                {
                  externalId,
                  contextId: input.contextId,
                  capability: event.capability,
                  reason: event.reason,
                  payload: event.payload,
                },
                policy,
                {
                  propose: async (r) => {
                    const p = await this.#broker.propose({
                      contextId: r.contextId,
                      capability: r.capability,
                      reason: r.reason,
                      payload: r.payload,
                    });
                    return 'error' in p ? { error: p.error } : { id: p.id };
                  },
                  status: (requestId) => this.#broker.status(requestId),
                  resolve: (id, decision, rationale) =>
                    resolveApproval(session.value, id, decision, rationale),
                  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
                  now: () => Date.now(),
                },
              );

              // Recorded either way. An approval that happened outside the
              // sandbox is exactly the thing a reader of the log needs to see.
              await this.#contexts.appendEvent(
                input.contextId,
                'permission.requested',
                `${event.capability} (via OpenClaw): ${outcome.decision} — ${outcome.rationale}`,
                outcome.requestId ? { requestId: outcome.requestId } : {},
              );

              if (outcome.decision === 'deny') {
                yield { type: 'error', message: outcome.rationale, recoverable: true };
              }
              break;
            }

            const proposed = await this.#broker.propose({
              contextId: input.contextId,
              capability: event.capability,
              reason: event.reason,
              payload: event.payload,
            });
            if ('error' in proposed) {
              yield { type: 'error', message: proposed.error, recoverable: true };
              break;
            }
            await this.#contexts.appendEvent(
              input.contextId,
              'permission.requested',
              `${event.capability}: ${event.reason}`,
              { requestId: proposed.id },
            );
            yield {
              type: 'permission-pending',
              requestId: proposed.id,
              capability: event.capability,
              reason: event.reason,
              risk: proposed.risk,
            };
            break;
          }

          case 'ui': {
            // Re-validate at the process boundary even though the provider
            // already did: the two are separate trust decisions.
            const validated = validateSairiUI(event.document);
            if (!validated.ok) {
              yield {
                type: 'ui-rejected',
                reason: validated.error.reason,
                messages: validated.error.messages,
              };
              break;
            }
            const stored = await this.#contexts.setUi(input.contextId, validated.value);
            if (!stored.ok) {
              this.#log.warn('context service refused the UI document', { detail: stored.detail });
              yield {
                type: 'ui-rejected',
                reason: 'schema',
                messages: [stored.detail ?? 'The context service rejected the document.'],
              };
              break;
            }
            yield { type: 'ui', document: validated.value };
            break;
          }

          case 'message': {
            await this.#contexts.appendEvent(
              input.contextId,
              'agent.message',
              event.text.slice(0, 200),
            );
            yield event;
            break;
          }

          case 'error': {
            await this.#contexts.appendEvent(
              input.contextId,
              'agent.error',
              event.message.slice(0, 200),
            );
            yield event;
            break;
          }

          default:
            yield event;
        }
      }
    } catch (cause) {
      this.#log.error('provider stream failed', { error: cause });
      yield {
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        recoverable: false,
      };
      yield { type: 'done' };
    } finally {
      await provider.closeSession(session.value);
    }
  }
}
