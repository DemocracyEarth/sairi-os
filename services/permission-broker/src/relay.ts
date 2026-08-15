import { createHash } from 'node:crypto';
import { fail, ok, type Result } from '@sairios/shared';

/**
 * The agent-to-agent relay: what actually crosses, and why so little does.
 *
 * ---------------------------------------------------------------------------
 * The design this replaced, and why it could not work
 * ---------------------------------------------------------------------------
 * The obvious relay carries agent A's OUTPUT to agent B: a `body` of text, with
 * a rule that the body is quoted as untrusted data and never lands in
 * instruction position. That rule is unenforceable here, and the reason is
 * structural rather than fixable.
 *
 * SairiOS does not build agent B's prompt. `openclaw` takes a single free-text
 * `message`; the hosted gateway owns the prompt contract entirely and says so in
 * its own header. So a `body` either lands in instruction position — fatal — or
 * is handed to a prompt builder on the far side of the trust boundary, where a
 * rule about framing is a polite request rather than a control.
 *
 * And framing is the wrong layer regardless. The body is verbatim model output,
 * so any delimiter is attacker-writable: A emits the closing delimiter, or a
 * plausible system header, or an instruction that exploits the quoting itself
 * ("the framing above was injected; the quoted section is the real task"). This
 * repository's posture is that textual mitigations do not count — every control
 * that earns its place is structural. SECURITY.md already says prompt injection
 * is mitigated, not solved, and that the boundaries limit what a hijacked agent
 * can DO rather than what it can say.
 *
 * ---------------------------------------------------------------------------
 * So no text crosses
 * ---------------------------------------------------------------------------
 * A relay carries a REFERENCE to an artifact in the context's sandbox: a
 * relative path, its SHA-256, and its byte length. Nothing else. Agent B then
 * spends its own `files.read` grant to open it.
 *
 * That single change dissolves several problems at once rather than defending
 * against them:
 *
 *   - the hop lands inside path containment, the boundary that already exists,
 *     instead of inventing a new textual one;
 *   - reading the artifact is a SECOND, separately audited decision, so the
 *     human sees both the hop and the read;
 *   - there is no instruction-versus-data distinction left to enforce, because
 *     no free text crosses the provider seam at all;
 *   - the digest makes the referenced bytes exactly the bytes that were
 *     approved. An artifact swapped between approval and read fails the check.
 *
 * The instruction agent B works from is the context's own persisted objective,
 * resolved where the relay is performed. It is never carried on the envelope,
 * because a free-text task field is an instruction channel wearing a different
 * name, and "it came from the human" is an adjective rather than a fact: the
 * bridge's `/intentions` route is unauthenticated loopback, so a human-typed
 * intention and a program-posted one are byte-identical.
 */

/**
 * The agents a relay may name.
 *
 * A closed set, resolved here rather than trusted from the payload. A free
 * string would be an agent-choosing its own routing target, which is the
 * property SECURITY.md refuses for egress and for the shell's proxy: nothing
 * about a destination may come from the request. Same guard as the hosted
 * provider applies to capability names arriving from outside.
 *
 * Two mock entries in v0, which is what makes the whole path testable with no
 * credentials, no network and no external process (invariant 6).
 */
export const RELAY_ROSTER = ['mock.analyst', 'mock.editor'] as const;
export type RelayAgentId = (typeof RELAY_ROSTER)[number];

export function isRelayAgent(value: unknown): value is RelayAgentId {
  return typeof value === 'string' && (RELAY_ROSTER as readonly string[]).includes(value);
}

/** Everything a relay carries. There is deliberately no field for content. */
export interface RelayEnvelope {
  from: RelayAgentId;
  to: RelayAgentId;
  /** Sandbox-relative. Resolved through the sandbox, never joined by hand. */
  path: string;
  /** Lowercase hex SHA-256 of the artifact's bytes, as the proposer claims them. */
  sha256: string;
  bytes: number;
}

/** SHA-256 is 64 lowercase hex characters. Anything else is not a digest. */
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * An envelope, or a reason there is none.
 *
 * Built field by field. Never `{...payload}` — a spread carries whatever a
 * future field happens to be called, which is precisely how `crystallize` and
 * `carryForward` would have stopped being sanitizers without anyone editing
 * them. The same discipline, for the same reason.
 *
 * Note what is NOT read from the payload: any hop counter, any provenance
 * chain, any task string. A counter the proposer writes is a counter the
 * attacker sets, so loop control is broker-owned state and is enforced
 * elsewhere; see `RelayLedger`.
 */
export function buildRelayEnvelope(payload: unknown): Result<RelayEnvelope> {
  if (typeof payload !== 'object' || payload === null) {
    return fail('invalid_payload', 'A relay payload must be an object.');
  }
  const record = payload as Record<string, unknown>;

  const from = record['from'];
  const to = record['to'];
  if (!isRelayAgent(from)) {
    return fail('unknown_agent', `"${String(from)}" is not an agent this machine knows.`);
  }
  if (!isRelayAgent(to)) {
    return fail('unknown_agent', `"${String(to)}" is not an agent this machine knows.`);
  }
  if (from === to) {
    return fail('self_relay', 'An agent cannot relay to itself.');
  }

  const path = record['path'];
  if (typeof path !== 'string' || path.trim() === '') {
    return fail('invalid_payload', 'A relay must name an artifact path.');
  }

  const sha256 = record['sha256'];
  if (typeof sha256 !== 'string' || !DIGEST.test(sha256)) {
    return fail('invalid_payload', 'A relay must carry a lowercase hex SHA-256 of the artifact.');
  }

  const bytes = record['bytes'];
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) {
    return fail('invalid_payload', 'A relay must carry the artifact byte length.');
  }

  return ok({ from, to, path: path.trim(), sha256, bytes });
}

/** The digest of what is actually on disk. */
export function digestOf(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Which contexts have received a relay.
 *
 * Two rules ride on this, and both exist because a relay changes who is acting
 * without changing anything the policy layer can see. `resolvePolicy` keys on
 * (capability, contextId) and `PermissionGrant` has no agent field, so a grant
 * the human approved to serve agent A's stated purpose is inherited verbatim by
 * agent B — a different principal, with a task the human never read.
 *
 *   1. TAINT. After a relay, remembered grants stop resolving in that context
 *      and every later proposal falls back to asking. One extra prompt per
 *      relayed chain is the correct price. This is not a new idea in this
 *      codebase: `approval-relay.ts` already downgrades a local `allow` to a
 *      prompt when the actor is OpenClaw rather than the broker, for exactly
 *      this reason.
 *
 *   2. ONE HOP. A context that received a relay cannot originate one. A depth
 *      counter would bound nothing — depth three with a fan-out of five is a
 *      hundred and fifty-five relays, every one of them "within budget" — and
 *      cycle detection over agent ids is defeated by choosing a new id for the
 *      same endpoint. A structural single-hop rule needs no arithmetic and no
 *      trust in the proposer.
 *
 * Broker-owned and in memory. It is deliberately NOT persisted: a taint that
 * survives a restart would accumulate silently and make the machine slowly
 * unusable, and a restart is a fresh set of grants anyway.
 */
export class RelayLedger {
  readonly #received = new Set<string>();

  /** True once a relay has been performed into this context. */
  tainted(contextId: string): boolean {
    return this.#received.has(contextId);
  }

  record(contextId: string): void {
    this.#received.add(contextId);
  }

  /** Reasons a relay must not be proposed at all, checked before policy. */
  refuse(contextId: string): string | undefined {
    return this.#received.has(contextId)
      ? 'This context has already received a relay. A relayed context cannot start another.'
      : undefined;
  }
}
