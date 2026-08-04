import { CAPABILITIES, type Capability, type PolicyDecision } from '@sairios/context-schema';

/**
 * Capability policy.
 *
 * Every capability has exactly one policy: allow, ask or deny. There is no
 * implicit fourth state and no "unset" — an unknown capability is refused
 * before it reaches this table.
 */

export const DEFAULT_POLICIES: Readonly<Record<Capability, PolicyDecision>> = {
  'files.read': 'ask',
  'files.write': 'ask',
  'files.delete': 'deny',
  'process.list': 'allow',
  'process.execute': 'deny',
  'network.fetch': 'ask',
  'browser.open': 'ask',
  'clipboard.read': 'deny',
  'clipboard.write': 'ask',
  'notifications.send': 'ask',
  'system.settings.read': 'allow',
};

export type RiskLevel = 'low' | 'medium' | 'high';

export interface CapabilityDescriptor {
  capability: Capability;
  /** One sentence the user reads before approving. Written for a human, not a developer. */
  summary: string;
  risk: RiskLevel;
  /** What v0 actually does. Kept honest: most capabilities are simulated. */
  v0Behaviour: string;
  /**
   * True when executing this does something REAL — a real mutation, or real
   * data returned. False when v0 fabricates the outcome.
   *
   * This must equal `!outcome.simulated` from actions.ts for the same
   * capability, and `capability-honesty.test.ts` executes every capability to
   * prove it. The two are the same claim made at different moments: this one
   * before the user approves, `simulated` after it ran. If they disagree, the
   * approval prompt is lying about what is about to happen.
   *
   * Read the name carefully. "Side effect" is loose: `system.settings.read`
   * mutates nothing yet returns real configuration, so it is `true`. The
   * question is "is this real", not "does this write". Getting that backwards
   * is exactly the bug this comment exists to prevent — it shipped once, and
   * put the wrong capability count in three documents.
   */
  realSideEffect: boolean;
}

export const CAPABILITY_DESCRIPTORS: Readonly<Record<Capability, CapabilityDescriptor>> = {
  'files.read': {
    capability: 'files.read',
    summary: 'Read a file from this context’s sandbox folder.',
    risk: 'medium',
    v0Behaviour: 'Reads a real file, but only inside the context sandbox directory.',
    realSideEffect: true,
  },
  'files.write': {
    capability: 'files.write',
    summary: 'Create or modify a file in this context’s sandbox folder.',
    risk: 'medium',
    v0Behaviour: 'Writes a real file, but only inside the context sandbox directory.',
    realSideEffect: true,
  },
  'files.delete': {
    capability: 'files.delete',
    summary: 'Delete a file from this context’s sandbox folder.',
    risk: 'high',
    v0Behaviour: 'Denied by default. Even when allowed, confined to the context sandbox.',
    realSideEffect: true,
  },
  'process.list': {
    capability: 'process.list',
    summary: 'See which SairiOS services are running.',
    risk: 'low',
    v0Behaviour:
      'Reports SairiOS’s own services only. Host processes are never enumerated for an agent.',
    realSideEffect: false,
  },
  'process.execute': {
    capability: 'process.execute',
    summary: 'Run a program.',
    risk: 'high',
    v0Behaviour:
      'Not implemented. There is no code path from an agent to process execution in v0, and the ' +
      'default policy is deny regardless.',
    realSideEffect: false,
  },
  'network.fetch': {
    capability: 'network.fetch',
    summary: 'Fetch a page or file from the network.',
    risk: 'high',
    v0Behaviour: 'Simulated. Returns a fixed placeholder response; no socket is opened.',
    realSideEffect: false,
  },
  'browser.open': {
    capability: 'browser.open',
    summary: 'Open a link in a browser.',
    risk: 'medium',
    v0Behaviour: 'Simulated. Records the intent; no browser is launched.',
    realSideEffect: false,
  },
  'clipboard.read': {
    capability: 'clipboard.read',
    summary: 'Read the system clipboard.',
    risk: 'high',
    v0Behaviour: 'Denied by default. Simulated even when allowed; the real clipboard is not read.',
    realSideEffect: false,
  },
  'clipboard.write': {
    capability: 'clipboard.write',
    summary: 'Put something on the system clipboard.',
    risk: 'medium',
    v0Behaviour: 'Simulated. Records the intent; the real clipboard is not modified.',
    realSideEffect: false,
  },
  'notifications.send': {
    capability: 'notifications.send',
    summary: 'Show you a desktop notification.',
    risk: 'low',
    v0Behaviour: 'Simulated. The notification is recorded in the context activity log.',
    realSideEffect: false,
  },
  'system.settings.read': {
    capability: 'system.settings.read',
    summary: 'Read SairiOS’s own configuration.',
    risk: 'low',
    v0Behaviour:
      'Returns SairiOS settings only (provider mode, ports, sandbox path). No host settings, ' +
      'no environment variables, no secrets.',
    // Real, not simulated: actions.ts returns the live agentProvider, bindHost,
    // storeDriver and sandbox root. It is the only capability that returns real
    // data while mutating nothing, which is how it came to be the only one
    // whose two honesty flags disagreed.
    realSideEffect: true,
  },
};

/** A decision the user asked SairiOS to remember. */
export interface RememberedDecision {
  capability: Capability;
  decision: 'allow' | 'deny';
  /** `context` applies to one context; `global` applies everywhere. */
  scope: 'context' | 'global';
  contextId: string | null;
  decidedAt: string;
}

export interface PolicySnapshot {
  defaults: Readonly<Record<Capability, PolicyDecision>>;
  remembered: readonly RememberedDecision[];
}

/**
 * Resolves the effective policy for a capability in a context.
 *
 * Precedence, most specific first:
 *   1. a decision remembered for THIS context
 *   2. a decision remembered globally
 *   3. the default policy
 *
 * A remembered `deny` is never overridden by a broader `allow`: denial is
 * sticky by design, so "deny and remember" cannot be widened by a later
 * global preference.
 */
export function resolvePolicy(
  capability: Capability,
  contextId: string,
  snapshot: PolicySnapshot,
): { decision: PolicyDecision; source: 'context-memory' | 'global-memory' | 'default' } {
  const forContext = snapshot.remembered.find(
    (r) => r.capability === capability && r.scope === 'context' && r.contextId === contextId,
  );
  if (forContext) return { decision: forContext.decision, source: 'context-memory' };

  const global = snapshot.remembered.find(
    (r) => r.capability === capability && r.scope === 'global',
  );
  if (global) return { decision: global.decision, source: 'global-memory' };

  return { decision: DEFAULT_POLICIES[capability], source: 'default' };
}

export function isKnownCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

export { CAPABILITIES };
