import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import type { Capability } from '@sairios/context-schema';
import type { Result } from '@sairios/shared';

/**
 * The agent provider seam.
 *
 * The desktop shell never talks to an LLM, and never talks to OpenClaw. It
 * talks to the agent bridge, which talks to a provider behind this interface.
 * Two implementations ship: `mock` (deterministic, offline, no credentials) and
 * `openclaw` (a pinned upstream runtime reached over its gateway).
 *
 * Everything crossing this interface is normalized. If OpenClaw changes its
 * internals, exactly one file changes.
 */

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'status'; status: 'thinking' | 'streaming' | 'waiting-permission' | 'idle' }
  | { type: 'message'; text: string }
  /** A capability the agent wants. The bridge forwards it to the permission broker. */
  | { type: 'permission-request'; capability: Capability; reason: string; payload: unknown }
  /** A SairiUI document. Validated by the bridge before it is emitted. */
  | { type: 'ui'; document: SairiUIDocument }
  | { type: 'ui-rejected'; reason: string; messages: string[] }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export interface IntentionInput {
  contextId: string;
  intention: string;
  contextType: 'ephemeral' | 'persistent' | 'crystallized';
  contextName: string;
  /** Prior objective, if the context already had one. */
  objective?: string;
}

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  /** A sentence explaining exactly what is missing, written for a human. */
  detail: string;
  /** True when this provider can run with no credentials at all. */
  offline: boolean;
}

export interface AgentProvider {
  readonly name: string;
  /** Never throws. Reports what is configured and what is not. */
  status(): Promise<ProviderStatus>;
  createSession(contextId: string): Promise<Result<string>>;
  /** Streams normalized events. Implementations must not throw mid-stream. */
  run(sessionId: string, input: IntentionInput): AsyncIterable<AgentEvent>;
  closeSession(sessionId: string): Promise<void>;
}
