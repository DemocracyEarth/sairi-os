import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Capability } from '@sairios/context-schema';
import { fail, newId, ok, systemClock, type Clock, type Result } from '@sairios/shared';
import { type SairiEnv } from '@sairios/shared/node';
import { executeAction, type ActionOutcome } from './actions.js';
import { RelayLedger } from './relay.js';
import { NO_REQUEST, type AuditRecord, type AuditSink } from './audit.js';
import {
  CAPABILITY_DESCRIPTORS,
  DEFAULT_POLICIES,
  isKnownCapability,
  resolvePolicy,
  type PolicySnapshot,
  type RememberedDecision,
  type RiskLevel,
} from './policy.js';
import { Sandbox } from './sandbox.js';

/**
 * The permission broker.
 *
 * Three phases, deliberately separated so that no single call can go from
 * "the agent wants something" to "it happened":
 *
 *   1. OBSERVATION  describe() — what a capability means and what it would do.
 *                   Free of side effects. Safe to call from the UI at any time.
 *   2. PROPOSAL     propose() — records an intent and resolves the policy.
 *                   Never executes. Returns `pending` when the user must decide.
 *   3. EXECUTION    execute() — runs the action, and only for a request that is
 *                   already in the `allowed` state.
 *
 * The agent can reach phases 1 and 2. Only a user decision moves a request from
 * phase 2 to phase 3.
 */

export type RequestStatus = 'pending' | 'allowed' | 'denied' | 'executed' | 'failed' | 'cancelled';

export interface PermissionRequest {
  id: string;
  contextId: string;
  capability: Capability;
  reason: string;
  risk: RiskLevel;
  status: RequestStatus;
  createdAt: string;
  decidedAt?: string;
  /**
   * True only when a human answered this specific request. False for one that
   * policy allowed on its own — including from a remembered grant.
   *
   * `decidedAt` cannot stand in for this: propose() stamps it on auto-allowed
   * requests too, so the two look identical afterwards. The distinction matters
   * at execution, where a grant that has since been revoked must stop a request
   * it authorised, while an explicit "allow once" must still be honoured.
   */
  userDecided?: boolean;
  executedAt?: string;
  /** Where the effective policy came from, shown to the user. */
  policySource: 'context-memory' | 'global-memory' | 'default';
  /** Payload the agent proposed. Validated at execution time, never before. */
  payload: unknown;
  outcome?: ActionOutcome;
  error?: { code: string; message: string };
}

export interface DecisionInput {
  decision: 'allow' | 'deny';
  /** `once` is consumed by the next execute(); `context` persists for this context. */
  scope: 'once' | 'context';
  /** "deny and remember" / "allow for this context" set this. */
  remember: boolean;
  /** When true a remembered decision applies to every context, not just this one. */
  global?: boolean;
}

export interface BrokerOptions {
  env: SairiEnv;
  audit: AuditSink;
  clock?: Clock;
  /** Where remembered decisions are persisted. Omit for an in-memory broker. */
  policyFile?: string;
}

export class PermissionBroker {
  readonly #env: SairiEnv;
  readonly #audit: AuditSink;
  readonly #clock: Clock;
  readonly #sandbox: Sandbox;
  readonly #policyFile: string | undefined;
  readonly #requests = new Map<string, PermissionRequest>();
  #remembered: RememberedDecision[] = [];
  /**
   * Which contexts have received a relay. Broker-owned, never read from a
   * payload — a counter the proposer writes is a counter the attacker sets.
   */
  readonly #relays = new RelayLedger();

  constructor(options: BrokerOptions) {
    this.#env = options.env;
    this.#audit = options.audit;
    this.#clock = options.clock ?? systemClock;
    this.#policyFile = options.policyFile;
    this.#sandbox = new Sandbox({ root: options.env.sandboxDir });
  }

  // --- phase 1: observation ------------------------------------------------

  /** Describes a capability. No side effects; safe for the UI to call freely. */
  describe(capability: string): Result<{
    capability: Capability;
    summary: string;
    risk: RiskLevel;
    v0Behaviour: string;
    realSideEffect: boolean;
    defaultPolicy: string;
  }> {
    if (!isKnownCapability(capability)) {
      return fail('unknown_capability', `"${capability}" is not a SairiOS capability.`);
    }
    const d = CAPABILITY_DESCRIPTORS[capability];
    return ok({ ...d, defaultPolicy: DEFAULT_POLICIES[capability] });
  }

  policySnapshot(): PolicySnapshot {
    return { defaults: DEFAULT_POLICIES, remembered: [...this.#remembered] };
  }

  effectivePolicy(capability: Capability, contextId: string) {
    const resolved = resolvePolicy(capability, contextId, this.policySnapshot());
    /*
     * THE TAINT. After a relay, remembered grants stop resolving in that
     * context and everything falls back to asking.
     *
     * `resolvePolicy` keys on (capability, contextId) and `PermissionGrant`
     * carries no agent, so a grant the human approved to serve one agent's
     * stated purpose is inherited verbatim by whichever agent was relayed in —
     * a different principal, working from a task the human never read. Without
     * this, a relay launders permission and the audit trail still shows a
     * capability the user did approve.
     *
     * A remembered DENY is left alone: denial is sticky by design everywhere
     * else in this file, and re-asking a question the user already answered
     * with "no" would be the one downgrade that annoys rather than protects.
     */
    if (
      this.#relays.tainted(contextId) &&
      resolved.decision === 'allow' &&
      resolved.source !== 'default'
    ) {
      return { decision: 'ask' as const, source: resolved.source };
    }
    return resolved;
  }

  // --- phase 2: proposal ---------------------------------------------------

  /**
   * Records an intent. This NEVER executes anything, whatever the policy says:
   * an `allow` policy produces an `allowed` request that still requires a
   * separate execute() call, so the audit trail always contains both steps.
   */
  async propose(input: {
    contextId: string;
    capability: string;
    reason: string;
    payload?: unknown;
  }): Promise<Result<PermissionRequest>> {
    if (!isKnownCapability(input.capability)) {
      return fail('unknown_capability', `"${input.capability}" is not a SairiOS capability.`);
    }
    if (typeof input.contextId !== 'string' || !/^ctx_[0-9a-f]{32}$/.test(input.contextId)) {
      return fail('invalid_context_id', 'A valid context id is required to attribute this action.');
    }
    const capability = input.capability;
    /*
     * ONE HOP, checked before policy so no amount of remembered permission gets
     * past it. A depth counter would bound nothing — depth three with a fan-out
     * of five is a hundred and fifty-five relays, all "within budget" — and
     * cycle detection over agent ids is defeated by naming a new id for the same
     * endpoint. A structural rule needs no arithmetic and trusts no counter.
     */
    if (capability === 'agent.relay') {
      const refusal = this.#relays.refuse(input.contextId);
      if (refusal) return fail('relay_chain_refused', refusal);
    }
    const descriptor = CAPABILITY_DESCRIPTORS[capability];
    const resolved = this.effectivePolicy(capability, input.contextId);

    const status: RequestStatus =
      resolved.decision === 'allow'
        ? 'allowed'
        : resolved.decision === 'deny'
          ? 'denied'
          : 'pending';

    const request: PermissionRequest = {
      id: newId('req'),
      contextId: input.contextId,
      capability,
      reason: String(input.reason ?? '').slice(0, 1000),
      risk: descriptor.risk,
      status,
      createdAt: this.#clock.isoNow(),
      policySource: resolved.source,
      payload: input.payload ?? {},
      ...(status === 'pending' ? {} : { decidedAt: this.#clock.isoNow() }),
    };
    this.#requests.set(request.id, request);

    await this.#audit.append({
      contextId: request.contextId,
      requestId: request.id,
      capability,
      phase:
        status === 'allowed' ? 'auto-allowed' : status === 'denied' ? 'auto-denied' : 'proposed',
      summary: `${capability}: ${descriptor.summary} (policy ${resolved.decision} via ${resolved.source})`,
      detail: { reason: request.reason },
    });

    return ok(request);
  }

  /** Records the user's answer to a pending request. */
  async decide(requestId: string, input: DecisionInput): Promise<Result<PermissionRequest>> {
    const request = this.#requests.get(requestId);
    if (!request) return fail('unknown_request', 'No such permission request.');
    if (request.status !== 'pending') {
      return fail(
        'not_pending',
        `This request is "${request.status}" and can no longer be decided.`,
      );
    }
    if (input.decision !== 'allow' && input.decision !== 'deny') {
      return fail('invalid_decision', 'A decision must be "allow" or "deny".');
    }

    request.status = input.decision === 'allow' ? 'allowed' : 'denied';
    request.decidedAt = this.#clock.isoNow();
    request.userDecided = true;
    request.policySource = 'context-memory';

    if (input.remember) {
      const remembered: RememberedDecision = {
        capability: request.capability,
        decision: input.decision,
        scope: input.global ? 'global' : 'context',
        contextId: input.global ? null : request.contextId,
        decidedAt: request.decidedAt,
      };
      // A remembered decision replaces any previous one at the same scope.
      this.#remembered = this.#remembered.filter(
        (r) =>
          !(
            r.capability === remembered.capability &&
            r.scope === remembered.scope &&
            r.contextId === remembered.contextId
          ),
      );
      this.#remembered.push(remembered);
      await this.#persistPolicies();
    }

    await this.#audit.append({
      contextId: request.contextId,
      requestId: request.id,
      capability: request.capability,
      phase: 'decided',
      summary: `User chose ${input.decision} (${input.scope}${input.remember ? ', remembered' : ''})`,
    });

    return ok(request);
  }

  /** Cancels a request that has not executed. Cancellation is always available. */
  async cancel(requestId: string): Promise<Result<PermissionRequest>> {
    const request = this.#requests.get(requestId);
    if (!request) return fail('unknown_request', 'No such permission request.');
    if (request.status === 'executed') {
      return fail('already_executed', 'This action has already run and cannot be cancelled.');
    }
    request.status = 'cancelled';
    await this.#audit.append({
      contextId: request.contextId,
      requestId: request.id,
      capability: request.capability,
      phase: 'cancelled',
      summary: 'Request cancelled',
    });
    return ok(request);
  }

  // --- phase 3: execution --------------------------------------------------

  /** Executes an allowed request. The only path from a decision to a side effect. */
  async execute(requestId: string): Promise<Result<PermissionRequest>> {
    const request = this.#requests.get(requestId);
    if (!request) return fail('unknown_request', 'No such permission request.');
    if (request.status !== 'allowed') {
      return fail(
        'not_allowed',
        `Cannot execute a request in state "${request.status}". Only "allowed" requests run.`,
      );
    }

    // Re-check the policy at execution time. A "deny and remember" recorded
    // between the decision and the execution must win.
    const current = this.effectivePolicy(request.capability, request.contextId);

    // Two ways to lose authorisation between the decision and the execution.
    //
    // A recorded `deny` is the obvious one. The second is subtler and used to
    // slip through: a request that policy allowed on its own, from a remembered
    // grant that has since been REVOKED. Revocation leaves the policy at `ask`,
    // not `deny`, so a check that only looked for `deny` let the request run on
    // an authorisation that no longer existed — which would have made
    // "revocable" untrue for anything already in flight.
    //
    // A request a human explicitly allowed is untouched. Withdrawing a standing
    // grant is not the same as taking back an individual "allow once".
    // Order matters. A hard `deny` is checked first and reports itself as one:
    // both conditions are true for a denied capability whose state has been
    // forged, and reporting that as a revoked grant would misdescribe an attack
    // as an ordinary withdrawal. `broker.test.ts` pins it.
    if (current.decision === 'deny') {
      request.status = 'denied';
      await this.#audit.append({
        contextId: request.contextId,
        requestId: request.id,
        capability: request.capability,
        phase: 'auto-denied',
        summary: 'Denied at execution time by a policy recorded after the decision',
      });
      return fail('denied_by_policy', 'A deny policy was recorded for this capability.');
    }

    if (!request.userDecided && current.decision !== 'allow') {
      request.status = 'denied';
      await this.#audit.append({
        contextId: request.contextId,
        requestId: request.id,
        capability: request.capability,
        phase: 'auto-denied',
        summary: 'Denied at execution time: the grant that authorised it was revoked',
      });
      return fail(
        'grant_revoked',
        'The remembered grant that allowed this was revoked before it ran.',
      );
    }

    const outcome = await executeAction(request.capability, request.payload, {
      contextId: request.contextId,
      sandbox: this.#sandbox,
      env: this.#env,
    });

    request.executedAt = this.#clock.isoNow();

    // Recorded only on a hop that really ran. A proposal, a denial or a failed
    // execution must not taint a context — that would let anyone degrade a
    // context's permissions by proposing relays that never happen.
    if (outcome.ok && request.capability === 'agent.relay') {
      this.#relays.record(request.contextId);
    }

    if (!outcome.ok) {
      request.status = 'failed';
      request.error = { code: outcome.error.code, message: outcome.error.message };
      await this.#audit.append({
        contextId: request.contextId,
        requestId: request.id,
        capability: request.capability,
        phase: 'failed',
        summary: outcome.error.message,
      });
      return ok(request);
    }

    request.status = 'executed';
    request.outcome = outcome.value;
    await this.#audit.append({
      contextId: request.contextId,
      requestId: request.id,
      capability: request.capability,
      phase: 'executed',
      summary: outcome.value.summary,
      detail: { simulated: outcome.value.simulated },
    });
    return ok(request);
  }

  // --- queries -------------------------------------------------------------

  get(requestId: string): PermissionRequest | undefined {
    return this.#requests.get(requestId);
  }

  pending(contextId?: string): readonly PermissionRequest[] {
    return [...this.#requests.values()].filter(
      (r) => r.status === 'pending' && (!contextId || r.contextId === contextId),
    );
  }

  forContext(contextId: string): readonly PermissionRequest[] {
    return [...this.#requests.values()].filter((r) => r.contextId === contextId);
  }

  auditRecent(limit: number, contextId?: string): Promise<readonly AuditRecord[]> {
    return this.#audit.recent(limit, contextId);
  }

  // --- persistence ---------------------------------------------------------

  async load(): Promise<void> {
    if (!this.#policyFile) return;
    try {
      const raw = await readFile(this.#policyFile, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.#remembered = parsed.filter(
          (r): r is RememberedDecision =>
            typeof r === 'object' &&
            r !== null &&
            isKnownCapability((r as RememberedDecision).capability) &&
            ((r as RememberedDecision).decision === 'allow' ||
              (r as RememberedDecision).decision === 'deny'),
        );
      }
    } catch {
      // No stored policies yet, or an unreadable file: fall back to defaults
      // rather than failing to start. Defaults are the safe direction.
      this.#remembered = [];
    }
  }

  /**
   * Withdraws remembered grants.
   *
   * Until this existed, "allow for this context" was permanent: nothing cleared
   * it when the context was archived and there was no way to take it back. A
   * permission system you can only add to is a ratchet, and a ratchet trains
   * people to think before the first click and never again.
   *
   * It is also the precondition SECURITY.md names for remote access. A grant
   * made from a laptop that is now on a train has to be withdrawable from
   * somewhere else, or the honest advice is not to grant anything remotely.
   *
   * `all` is a separate flag rather than "omit the filters", because a revoke
   * that clears everything when its argument is accidentally undefined is a
   * footgun aimed at the one table the user cannot reconstruct.
   */
  async revoke(
    filter: { capability?: Capability; contextId?: string | null; all?: boolean } = {},
  ): Promise<Result<{ revoked: RememberedDecision[] }>> {
    const { capability, contextId, all } = filter;
    if (!all && !capability && contextId === undefined) {
      return fail(
        'invalid_revoke',
        'Name a capability, a context, or pass all:true. Refusing to guess.',
      );
    }
    if (capability !== undefined && !isKnownCapability(capability)) {
      return fail('unknown_capability', `"${capability}" is not a SairiOS capability.`);
    }

    const matches = (r: RememberedDecision): boolean => {
      if (all) return true;
      if (capability !== undefined && r.capability !== capability) return false;
      if (contextId !== undefined && r.contextId !== contextId) return false;
      return true;
    };

    const revoked = this.#remembered.filter(matches);
    if (revoked.length === 0) return ok({ revoked: [] });

    this.#remembered = this.#remembered.filter((r) => !matches(r));
    await this.#persistPolicies();

    // Withdrawal is an event in its own right. An audit log that records every
    // grant and no revocation reads as though permissions only ever widened.
    for (const entry of revoked) {
      await this.#audit.append({
        contextId: entry.contextId ?? 'global',
        requestId: NO_REQUEST,
        capability: entry.capability,
        phase: 'revoked',
        summary: `Revoked remembered ${entry.decision} for ${entry.capability} (${entry.scope})`,
      });
    }

    return ok({ revoked });
  }

  async #persistPolicies(): Promise<void> {
    if (!this.#policyFile) return;
    await mkdir(dirname(this.#policyFile), { recursive: true });
    await writeFile(this.#policyFile, JSON.stringify(this.#remembered, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  /** Test seam: clears remembered decisions without touching disk. */
  resetRememberedForTests(): void {
    this.#remembered = [];
  }
}
