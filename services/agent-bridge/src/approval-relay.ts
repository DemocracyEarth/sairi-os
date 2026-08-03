import type { Capability } from '@sairios/context-schema';

/**
 * Relays an OpenClaw approval request through the SairiOS permission broker.
 *
 * OpenClaw has its own approval round trip: it emits `exec.approval.requested`
 * and waits for `exec.approval.resolve`. SairiOS has a permission broker that
 * does the same job. Left unwired, both prompt, and a user answers the same
 * question twice — or worse, answers it in OpenClaw's terms, where SairiOS's
 * policy, audit log and sandbox have no say at all.
 *
 * So there is exactly one decision, and it is SairiOS's.
 *
 * ---------------------------------------------------------------------------
 * The distinction this module exists to preserve
 * ---------------------------------------------------------------------------
 * A relayed approval is NOT the same act as a broker execution, and conflating
 * them would quietly gut the security model.
 *
 *   broker execution   the broker performs the action, inside the sandbox,
 *                      with path containment, a size cap and an audit entry.
 *
 *   relayed approval   OPENCLAW performs the action, in OpenClaw's process,
 *                      outside the sandbox. SairiOS decides whether it may,
 *                      and then it is out of our hands.
 *
 * That asymmetry drives every rule below. A grant given for the first is not a
 * grant for the second.
 */

export type RelayDecision = 'allow' | 'deny';

export interface RelayRequest {
  /** OpenClaw's own id for the approval. Needed to resolve it. */
  externalId: string;
  contextId: string;
  capability: Capability;
  reason: string;
  payload: unknown;
}

export interface RelayOutcome {
  decision: RelayDecision;
  /** Written to the audit trail and shown to the user. Never empty. */
  rationale: string;
  /** The broker request id, when one was raised. */
  requestId?: string;
}

/**
 * Policies that refuse a relayed approval outright, without asking anyone.
 *
 * `process.execute` is here for the reason it is denied everywhere else in this
 * project: unrestricted execution is not a feature SairiOS offers, and an
 * approval prompt is not a substitute for not having built it.
 */
const NEVER_RELAY: readonly Capability[] = ['process.execute'];

/**
 * Decides whether a relayed approval may skip the user.
 *
 * The answer is: only to deny. It never auto-allows, and that is deliberate.
 *
 * A local policy of `allow` means "the broker may do this in the sandbox
 * without asking" — `process.list` is `allow` because a sandboxed process
 * listing is harmless. It does NOT mean "OpenClaw may do this to the real
 * machine without asking". Treating those as the same value is the single
 * easiest way to turn this relay into a privilege escalation, so an `allow`
 * policy is downgraded to a prompt rather than honoured.
 *
 * `deny` is honoured in full: if SairiOS would not do it in the sandbox, it
 * certainly will not authorise OpenClaw to do it outside one.
 */
export function preDecide(
  capability: Capability,
  localPolicy: 'allow' | 'ask' | 'deny',
): RelayOutcome | undefined {
  if (NEVER_RELAY.includes(capability)) {
    return {
      decision: 'deny',
      rationale:
        `${capability} is never relayed. SairiOS does not implement unrestricted ` +
        `execution, and an approval prompt is not a substitute for that.`,
    };
  }
  if (localPolicy === 'deny') {
    return {
      decision: 'deny',
      rationale: `Policy for ${capability} is deny, so OpenClaw was refused without prompting.`,
    };
  }
  // 'allow' deliberately falls through to a prompt. See above.
  return undefined;
}

export interface RelayDeps {
  /** Raises the request with the broker. Returns its id, or an error. */
  propose(input: RelayRequest): Promise<{ id: string } | { error: string }>;
  /** Reads the request's current status. The relay polls this. */
  status(requestId: string): Promise<{ status: string } | undefined>;
  /** Sends the decision back to OpenClaw. */
  resolve(externalId: string, decision: RelayDecision, rationale: string): Promise<void>;
  /** Injected so tests do not sleep. */
  wait(ms: number): Promise<void>;
  now(): number;
}

export interface RelayOptions {
  /** How long to wait for a human before failing closed. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Runs one approval to a decision and tells OpenClaw the answer.
 *
 * Fails closed, always. An unreachable broker, an unparseable status, an
 * expired timeout and an outright refusal all end the same way: OpenClaw is
 * told `deny`. The only path to `allow` is a broker request that reached
 * `allowed` — nothing infers approval from silence.
 */
export async function relayApproval(
  request: RelayRequest,
  localPolicy: 'allow' | 'ask' | 'deny',
  deps: RelayDeps,
  options: RelayOptions = {},
): Promise<RelayOutcome> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;

  const settle = async (outcome: RelayOutcome): Promise<RelayOutcome> => {
    // Telling OpenClaw must not be able to change the decision. A transport
    // failure here leaves the request denied on our side, which is the safe
    // direction: OpenClaw's own timeout then refuses it too.
    try {
      await deps.resolve(request.externalId, outcome.decision, outcome.rationale);
    } catch {
      /* the decision stands regardless */
    }
    return outcome;
  };

  const early = preDecide(request.capability, localPolicy);
  if (early) return settle(early);

  const proposed = await deps.propose(request);
  if ('error' in proposed) {
    return settle({
      decision: 'deny',
      rationale: `The permission broker refused the request: ${proposed.error}`,
    });
  }

  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    const current = await deps.status(proposed.id);

    if (!current) {
      return settle({
        decision: 'deny',
        rationale: 'The permission broker lost the request.',
        requestId: proposed.id,
      });
    }

    switch (current.status) {
      case 'allowed':
      case 'executed':
        return settle({
          decision: 'allow',
          rationale:
            'Approved in SairiOS. NOTE: OpenClaw performs this action in its own ' +
            'process, not in the SairiOS sandbox, so it is not path-contained and ' +
            'its result is not recorded by the broker.',
          requestId: proposed.id,
        });

      case 'denied':
      case 'cancelled':
      case 'failed':
        return settle({
          decision: 'deny',
          rationale: `The request was ${current.status} in SairiOS.`,
          requestId: proposed.id,
        });

      default:
        // 'pending' and anything a newer broker introduces: keep waiting rather
        // than guessing what an unfamiliar status means.
        break;
    }

    await deps.wait(pollIntervalMs);
  }

  return settle({
    decision: 'deny',
    rationale:
      `No decision within ${Math.round(timeoutMs / 1000)}s, so OpenClaw was refused. ` +
      `An unanswered prompt is not consent.`,
    requestId: proposed.id,
  });
}
