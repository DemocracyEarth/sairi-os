/**
 * The roster: agents as durable colleagues rather than per-context fixtures.
 *
 * Until now an agent existed only inside the context that summoned it. The
 * Metrologist who spent a week learning that vendors quote their best qubit
 * pair while papers report medians forgot it the moment you closed the window,
 * and the next research context started that argument from zero.
 *
 * ---------------------------------------------------------------------------
 * Why this is not "configure your team"
 * ---------------------------------------------------------------------------
 * The obvious shape — let the user assemble a staff up front, then hand it work
 * — is the app-store metaphor wearing a new hat, and it inverts the thesis. In
 * SairiOS the INTENTION creates the context and the context summons what it
 * needs. Nobody picks agents from a grid.
 *
 * So the roster is not a place you go. It has no page and no navigation entry;
 * that would be the "apps grid" CLAUDE.md forbids. It is a property of the
 * agent population, surfaced in the two places it is already relevant: on an
 * agent's presence card inside a context, and during assembly, where "the
 * agents it selected" becomes "two of these have done this before".
 *
 * ---------------------------------------------------------------------------
 * Memory that crosses a context boundary is a security question
 * ---------------------------------------------------------------------------
 * An agent carrying anything out of context A and into context B is a data flow
 * across a trust boundary, and it is the same flow crystallization already
 * guards: something learned in a private workspace escaping into one the user
 * has not thought about. Two rules, both enforced below.
 *
 *   1. Only DERIVED notes travel. Never an agent's raw output, never a panel,
 *      never a file path, never the intention text of another context.
 *      `carryForward` builds an allow-listed object field by field and never
 *      spreads a record, for the same reason `crystallize` does not.
 *
 *   2. Every note is inspectable and retirable by the user. Memory you cannot
 *      read or delete is not memory, it is surveillance. A retired note stays
 *      visible in the history — so you can see what the agent used to believe —
 *      but stops travelling immediately.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is not
 * ---------------------------------------------------------------------------
 * SCAFFOLDING. This is the interface prototype, and like the rest of sairi/ it
 * is deterministic, offline and seeded from fixtures — no persistence, no
 * model, no network. Nothing here writes to disk or survives a reload.
 *
 * The durable version needs a domain-level sanitizer next to
 * packages/context-schema/src/crystallize.ts, because at that point notes are
 * produced by a model rather than written by hand, and the allow-list becomes
 * the only thing standing between two workspaces. `carryForward` is written to
 * be that function's shape so the move is a move rather than a rewrite. Its
 * tests are the ones that must come along.
 */

export type EngagementOutcome = 'accepted' | 'revised' | 'rejected' | 'ongoing';

/** One context an agent has worked in. */
export interface Engagement {
  contextId: string;
  /** The intention it served, for the user's recall. Does NOT travel forward. */
  intention: string;
  kind: string;
  /** One line: what this agent actually contributed there. */
  contribution: string;
  outcome: EngagementOutcome;
  /** Whole days since it closed. Ongoing engagements are 0. */
  daysAgo: number;
}

/**
 * A claim an agent carries between contexts.
 *
 * Deliberately a method or a calibration, never a fact about the user's data.
 * "Vendor fidelity figures quote the best pair, papers report medians" is
 * portable and safe. "The Delft group withheld four device traces" is neither.
 */
export interface StandingNote {
  id: string;
  text: string;
  /** contextId of the engagement that produced it. Every note is traceable. */
  from: string;
  /** Retired notes stay in the history and stop travelling. */
  retired?: boolean;
}

export interface AgentRecord {
  /** Stable across contexts. This is what makes an agent the same agent. */
  id: string;
  role: string;
  /** What this agent is for, independent of any one job. */
  charter: string;
  engagements: Engagement[];
  notes: StandingNote[];
}

/* ------------------------------------------------------------------------ *
 * The sanitizer
 * ------------------------------------------------------------------------ */

/** A note longer than this is not a heuristic, it is content. Truncated. */
export const NOTE_MAX_CHARS = 240;

/**
 * How many notes travel. A cap is not tidiness: unbounded accumulation is how
 * a summary quietly becomes a transcript, and a transcript is the thing this
 * whole file exists to keep out of the next context.
 */
export const NOTES_CARRIED_MAX = 5;

/**
 * Everything an agent is allowed to bring into a new context.
 *
 * Note what is absent and stays absent: engagements, intentions, contributions,
 * outputs, panel ids, context ids, hue, the record itself. A caller that wants
 * one of those in a new context has to add it here, in the open, with a test.
 */
export interface CarriedBriefing {
  role: string;
  charter: string;
  /** Plain strings. Not notes — the ids and provenance stay behind too. */
  notes: string[];
  /** A count, not a list. "Done this before" without saying what. */
  priorContexts: number;
}

export function carryForward(record: AgentRecord): CarriedBriefing {
  // Built field by field. Never `{...record}` — a spread carries whatever gets
  // added to AgentRecord later, which is exactly how a sanitizer stops working
  // without anybody editing it.
  return {
    role: clamp(record.role),
    charter: clamp(record.charter),
    notes: record.notes
      .filter((n) => !n.retired)
      .slice(0, NOTES_CARRIED_MAX)
      .map((n) => clamp(n.text)),
    priorContexts: record.engagements.length,
  };
}

/**
 * Takes `unknown` rather than `string` deliberately.
 *
 * Today every record is a hand-written fixture and the type holds. In the
 * durable version notes are produced by a model, which means this function is
 * the first thing to touch untrusted data — and a sanitizer that throws on a
 * malformed field is one somebody eventually wraps in a try/catch that skips
 * sanitizing. Dropping a bad field to empty keeps the failure inside the
 * allow-list instead of around it.
 */
function clamp(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= NOTE_MAX_CHARS ? flat : `${flat.slice(0, NOTE_MAX_CHARS - 1)}…`;
}

/* ------------------------------------------------------------------------ *
 * Reading a record
 * ------------------------------------------------------------------------ */

export interface TrackRecord {
  engagements: number;
  accepted: number;
  revised: number;
  rejected: number;
  ongoing: number;
  /**
   * null until at least one engagement has settled.
   *
   * The alternative — 0, or 100% — is a number the interface would render as
   * fact. An agent on its first job has no acceptance rate, and saying so is
   * the honest rendering.
   */
  acceptance: number | null;
}

export function trackRecord(record: AgentRecord): TrackRecord {
  const count = (o: EngagementOutcome): number =>
    record.engagements.filter((e) => e.outcome === o).length;

  const accepted = count('accepted');
  const revised = count('revised');
  const rejected = count('rejected');
  const settled = accepted + revised + rejected;

  return {
    engagements: record.engagements.length,
    accepted,
    revised,
    rejected,
    ongoing: count('ongoing'),
    acceptance: settled === 0 ? null : accepted / settled,
  };
}

/** Notes that would travel right now. */
export function standing(record: AgentRecord): StandingNote[] {
  return record.notes.filter((n) => !n.retired);
}

/** Has this agent worked this kind of context before? Drives assembly. */
export function isReturning(record: AgentRecord, kind: string): boolean {
  return record.engagements.some((e) => e.kind === kind);
}

/**
 * The record for a live agent, or a blank one for an agent on its first job.
 *
 * Synthesised rather than seeded so a new agent is handled by construction: no
 * lookup can fail, and no fixture has to be written for an agent with no past.
 */
export function recordFor(id: string, role: string, roster: Roster = ROSTER): AgentRecord {
  return roster[id] ?? { id, role, charter: '', engagements: [], notes: [] };
}

/** Retire or restore one note, returning a new roster. */
export function setNoteRetired(
  roster: Roster,
  agentId: string,
  noteId: string,
  retired: boolean,
): Roster {
  const record = roster[agentId];
  if (!record) return roster;
  return {
    ...roster,
    [agentId]: {
      ...record,
      notes: record.notes.map((n) => (n.id === noteId ? { ...n, retired } : n)),
    },
  };
}

export type Roster = Record<string, AgentRecord>;

/* ------------------------------------------------------------------------ *
 * Seed
 *
 * Eight agents with a past, keyed by the ids the four contexts already use.
 * The other twelve get blank records from recordFor(), which is the point: the
 * interface has to read correctly for a first-timer as well as a veteran, and
 * seeding only the veterans forces that case to exist.
 *
 * Two agents deliberately span kinds — the Metrologist has done research and
 * product design, the Budget keeper travel and design — because an agent that
 * only ever returns to the same kind of work is just a template with a memory.
 * ------------------------------------------------------------------------ */

/**
 * Empty, and honestly so.
 *
 * This held eight richly-described colleagues — a Metrologist, a Source
 * librarian — with engagement histories and standing notes. Every one of them
 * described work that never happened, so they went with the rest of the
 * fixtures.
 *
 * The machinery above is kept because it is the part that was worth building:
 * `carryForward` is the allow-list that decides what an agent may take from one
 * context into another, and its tests are the security-relevant ones. Records
 * will arrive here from real sessions. See Milestone 2.
 */
export const ROSTER: Roster = {};
