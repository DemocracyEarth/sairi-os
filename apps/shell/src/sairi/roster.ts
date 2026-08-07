import type { Agent, SairiContext, Spectral } from './state.js';

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
  kind: SairiContext['kind'];
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
  hue: Spectral;
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
export function isReturning(record: AgentRecord, kind: SairiContext['kind']): boolean {
  return record.engagements.some((e) => e.kind === kind);
}

/**
 * The record for a live agent, or a blank one for an agent on its first job.
 *
 * Synthesised rather than seeded so a new agent is handled by construction: no
 * lookup can fail, and no fixture has to be written for an agent with no past.
 */
export function recordFor(agent: Agent, roster: Roster = ROSTER): AgentRecord {
  return (
    roster[agent.id] ?? {
      id: agent.id,
      role: agent.role,
      hue: agent.hue,
      // Its current job stands in for a charter until it has done enough for
      // one to be visible. An agent with no past is described by its present.
      charter: agent.task ?? '',
      engagements: [],
      notes: [],
    }
  );
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

export const ROSTER: Roster = {
  'agent-metrologist': {
    id: 'agent-metrologist',
    role: 'Metrologist',
    hue: 'cyan',
    charter: 'Puts claimed numbers on a common scale before anyone compares them.',
    engagements: [
      {
        contextId: 'ctx-research',
        intention: 'Analyse recent quantum-computing breakthroughs',
        kind: 'research',
        contribution: 'Rebuilt every fidelity claim as a randomised-benchmarking median.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-sensor-claims',
        intention: 'Are the air-quality sensor accuracy claims defensible?',
        kind: 'design',
        contribution: 'Found three of five competitor accuracy figures were lab-only.',
        outcome: 'accepted',
        daysAgo: 12,
      },
      {
        contextId: 'ctx-latency-budget',
        intention: 'Where is the checkout latency budget actually going?',
        kind: 'incident',
        contribution: 'Separated p99 from mean in four dashboards that had conflated them.',
        outcome: 'accepted',
        daysAgo: 34,
      },
      {
        contextId: 'ctx-battery',
        intention: 'Compare battery life across the review sites',
        kind: 'research',
        contribution: 'Normalised to a common discharge test; two rankings inverted.',
        outcome: 'revised',
        daysAgo: 61,
      },
    ],
    notes: [
      {
        id: 'n-met-1',
        text: 'A vendor’s headline figure is almost always its best unit or best pair. Ask for the median and the sample size before comparing it to anything.',
        from: 'ctx-battery',
      },
      {
        id: 'n-met-2',
        text: 'Lab conditions and field conditions are different measurements wearing the same unit. Say which one a number is, every time.',
        from: 'ctx-sensor-claims',
      },
      {
        id: 'n-met-3',
        text: 'This user wants the raw spread, not the summary statistic. They have asked for it in four contexts.',
        from: 'ctx-latency-budget',
      },
    ],
  },

  'agent-librarian': {
    id: 'agent-librarian',
    role: 'Source librarian',
    hue: 'violet',
    charter: 'Ranks what a claim rests on, and refuses to promote a claim past its evidence.',
    engagements: [
      {
        contextId: 'ctx-research',
        intention: 'Analyse recent quantum-computing breakthroughs',
        kind: 'research',
        contribution: 'Tiered 41 sources by venue, independence and primary-data release.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-battery',
        intention: 'Compare battery life across the review sites',
        kind: 'research',
        contribution: 'Caught two review sites republishing the same vendor test.',
        outcome: 'accepted',
        daysAgo: 61,
      },
    ],
    notes: [
      {
        id: 'n-lib-1',
        text: 'Hold a vendor blog at tier 3 until a primary artefact exists — a dataset, a preprint, a referee file. Press coverage of a blog is still the blog.',
        from: 'ctx-battery',
      },
      {
        id: 'n-lib-2',
        text: 'Two sources that cite each other are one source. Check the citation graph before counting independence.',
        from: 'ctx-battery',
      },
    ],
  },

  'agent-adversary': {
    id: 'agent-adversary',
    role: 'Adversary',
    hue: 'magenta',
    charter: 'Tries to break the conclusion the other agents are converging on.',
    engagements: [
      {
        contextId: 'ctx-research',
        intention: 'Analyse recent quantum-computing breakthroughs',
        kind: 'research',
        contribution: 'Attacking the topological-qubit claim from the published referee file.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-vendor-sla',
        intention: 'Should we sign the three-year support agreement?',
        kind: 'research',
        contribution: 'Broke the availability case; the SLA excluded the failure mode we had.',
        outcome: 'accepted',
        daysAgo: 22,
      },
      {
        contextId: 'ctx-pricing',
        intention: 'Pricing strategy for the second product line',
        kind: 'design',
        contribution: 'Argued the elasticity read was an artefact of one promotion window.',
        outcome: 'rejected',
        daysAgo: 47,
      },
    ],
    notes: [
      {
        id: 'n-adv-1',
        text: 'When a result depends on data nobody outside the group has seen, that dependency is the finding. Say so before arguing about the result.',
        from: 'ctx-vendor-sla',
      },
      {
        id: 'n-adv-2',
        text: 'One rejected objection is not a reason to stop objecting, but it is a reason to say how confident I am up front.',
        from: 'ctx-pricing',
      },
    ],
  },

  'agent-correlator': {
    id: 'agent-correlator',
    role: 'Log correlator',
    hue: 'cyan',
    charter: 'Joins large volumes of machine output to the small number of things that went wrong.',
    engagements: [
      {
        contextId: 'ctx-incident',
        intention: 'Checkout payments are failing for some users',
        kind: 'incident',
        contribution: 'Joined 41.2M gateway lines to 4,218 failed carts.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-latency-budget',
        intention: 'Where is the checkout latency budget actually going?',
        kind: 'incident',
        contribution: 'Attributed 60% of the budget to one retry loop.',
        outcome: 'accepted',
        daysAgo: 34,
      },
      {
        contextId: 'ctx-webhook',
        intention: 'Webhooks are arriving twice for some tenants',
        kind: 'incident',
        contribution: 'Showed duplicates were redeliveries, not double-sends.',
        outcome: 'accepted',
        daysAgo: 58,
      },
    ],
    notes: [
      {
        id: 'n-cor-1',
        text: 'Start from the failures and join outward. Starting from the log volume means reading everything and finding whatever is loudest.',
        from: 'ctx-webhook',
      },
      {
        id: 'n-cor-2',
        text: 'The rows that do not match the pattern are worth more than the ones that do. Always report the residual count.',
        from: 'ctx-latency-budget',
      },
      {
        id: 'n-cor-3',
        text: 'This estate keeps its region tag in a different field per service. Confirm the field before joining across regions.',
        from: 'ctx-latency-budget',
      },
    ],
  },

  'agent-remedy': {
    id: 'agent-remedy',
    role: 'Remediation drafter',
    hue: 'amber',
    charter: 'Prepares the smallest change that would end the incident, and never applies it.',
    engagements: [
      {
        contextId: 'ctx-incident',
        intention: 'Checkout payments are failing for some users',
        kind: 'incident',
        contribution: 'Holding a two-region rollback of payments-gateway v2.31.0.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-webhook',
        intention: 'Webhooks are arriving twice for some tenants',
        kind: 'incident',
        contribution: 'Drafted an idempotency-key fix; you shipped a narrower one.',
        outcome: 'revised',
        daysAgo: 58,
      },
    ],
    notes: [
      {
        id: 'n-rem-1',
        text: 'State the blast radius in the first line — pods, regions, whether the schema moves. It is the only part read under time pressure.',
        from: 'ctx-webhook',
      },
      {
        id: 'n-rem-2',
        text: 'This user prefers a rollback to a forward fix during an active incident, and wants the forward fix drafted separately.',
        from: 'ctx-webhook',
      },
    ],
  },

  keeper: {
    id: 'keeper',
    role: 'Budget keeper',
    hue: 'mint',
    charter: 'Keeps the real total in front of the decision while it is still reversible.',
    engagements: [
      {
        contextId: 'ctx-travel',
        intention: 'Plan a multi-city trip to Japan in April',
        kind: 'travel',
        contribution: 'Reconciling a rail pass against point-to-point fares.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-launch-budget',
        intention: 'What does the March launch actually cost?',
        kind: 'design',
        contribution: 'Found the media plan double-counted the agency retainer.',
        outcome: 'accepted',
        daysAgo: 9,
      },
      {
        contextId: 'ctx-portugal',
        intention: 'A week in Portugal in October',
        kind: 'travel',
        contribution: 'Showed the flexible fare paid for itself against one likely change.',
        outcome: 'accepted',
        daysAgo: 140,
      },
    ],
    notes: [
      {
        id: 'n-kee-1',
        text: 'A rail pass loses to point-to-point below roughly six long legs. Check the leg count before pricing the pass.',
        from: 'ctx-portugal',
      },
      {
        id: 'n-kee-2',
        text: 'Price the cancellable option next to the cheap one whenever any leg is unsettled — this user changes plans mid-trip.',
        from: 'ctx-portugal',
      },
    ],
  },

  'a-synth': {
    id: 'a-synth',
    role: 'Insight synthesist',
    hue: 'violet',
    charter: 'Clusters what people said into themes that survive their own sample size.',
    engagements: [
      {
        contextId: 'ctx-design',
        intention: 'Launch strategy for a new product',
        kind: 'design',
        contribution: 'Clustered 214 beta interviews into four themes holding at n ≥ 30.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-churn',
        intention: 'Why did the February cohort churn?',
        kind: 'research',
        contribution: 'Two of six themes collapsed under a leave-one-out check.',
        outcome: 'accepted',
        daysAgo: 28,
      },
    ],
    notes: [
      {
        id: 'n-syn-1',
        text: 'Report the n on every theme, in the theme. A cluster without its size gets quoted as though it were universal.',
        from: 'ctx-churn',
      },
      {
        id: 'n-syn-2',
        text: 'Themes that appear in no requirement document are the ones worth surfacing first. The rest confirm what was already written.',
        from: 'ctx-churn',
      },
    ],
  },

  'a-scan': {
    id: 'a-scan',
    role: 'Market scanner',
    hue: 'cyan',
    charter: 'Watches what competitors actually do, as distinct from what they announce.',
    engagements: [
      {
        contextId: 'ctx-design',
        intention: 'Launch strategy for a new product',
        kind: 'design',
        contribution: 'Tracking price and claim moves across four launch markets.',
        outcome: 'ongoing',
        daysAgo: 0,
      },
      {
        contextId: 'ctx-pricing',
        intention: 'Pricing strategy for the second product line',
        kind: 'design',
        contribution: 'Built the price ladder that the positioning was written against.',
        outcome: 'accepted',
        daysAgo: 47,
      },
    ],
    notes: [
      {
        id: 'n-sca-1',
        text: 'A list price is a claim; the street price is the fact. Check a retailer before quoting a competitor’s number.',
        from: 'ctx-pricing',
      },
    ],
  },
};
