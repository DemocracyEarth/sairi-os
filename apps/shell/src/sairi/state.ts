import type { Context } from '@sairios/context-schema';

/**
 * The Sairi OS view model, derived from real contexts.
 *
 * ---------------------------------------------------------------------------
 * What this file used to be
 * ---------------------------------------------------------------------------
 * A fixture. It declared four contexts, twenty agents and sixteen bespoke
 * lenses — a knowledge graph, a map, a spatial canvas — about 6,800 lines of
 * hand-built SVG describing work that never happened. It was a prototype of
 * what an adaptive interface could look like, and it was very convincing,
 * which is precisely the problem: nothing in it was produced by an agent.
 *
 * It is gone. A context now comes from the context service, its interface is a
 * SairiUI document an agent actually emitted, and it is validated against the
 * sixteen-component catalog before anything renders.
 *
 * The cost is visible and worth stating: the catalog has `table`, `checklist`
 * and `timeline`, and it does not have a knowledge graph or a map. Real output
 * is plainer than the fixture was. Making it rich again means adding catalog
 * components deliberately, each one a schema entry, a renderer case and a
 * hostile-payload test — see invariant 3 in CLAUDE.md. Plain and real beats
 * beautiful and fabricated, but the gap is real.
 */

/** Where a surface sits on the convergence axis. Drives its whole appearance. */
export type Certainty = 'provisional' | 'forming' | 'resolved';

export const CERTAINTY_VALUE: Record<Certainty, number> = {
  provisional: 0.12,
  forming: 0.55,
  resolved: 1,
};

/**
 * A context's certainty, from signals that are actually true.
 *
 * The fixture set this by hand per panel, which is how a "provisional" panel
 * could contain a finished-looking chart. It is now derived, and only three
 * things can move it:
 *
 *   provisional  no interface yet — the agent has not produced anything
 *   forming      an interface exists and the work is still open
 *   resolved     the lifecycle says the work is finished
 *
 * That is a coarser signal than sixteen hand-tuned panels and it has the one
 * property the fixture lacked: it cannot be wrong.
 */
export function certaintyOf(context: Context): Certainty {
  if (context.status === 'completed' || context.status === 'archived') return 'resolved';
  return context.uiSpecification ? 'forming' : 'provisional';
}

export function convergence(context: Context): number {
  return CERTAINTY_VALUE[certaintyOf(context)];
}

/**
 * How long since the context was touched, in minutes. Drives navigator heat.
 *
 * Real timestamps, so a context genuinely does cool down while you are not
 * looking at it — the fixture hardcoded this and every reload reset it.
 */
export function minutesSince(iso: string, now = Date.now()): number {
  const then = Date.parse(iso);
  return Number.isFinite(then) ? Math.max(0, (now - then) / 60000) : 0;
}

/** The label above a context in the rail. The real lifecycle, not a genre. */
export const TYPE_LABEL: Record<Context['type'], string> = {
  ephemeral: 'Ephemeral',
  persistent: 'Persistent',
  crystallized: 'Template',
};

export const STATUS_LABEL: Record<Context['status'], string> = {
  draft: 'draft',
  active: 'working',
  waiting: 'waiting on you',
  completed: 'done',
  archived: 'archived',
  failed: 'failed',
};

/* -------------------------------------------------------------------------- *
 * The live run
 *
 * One agent session per context, which is what the bridge actually streams —
 * not the five named colleagues the fixture drew. `trail` is an activity log
 * and deliberately not a transcript: it is what the agent DID, kept short,
 * shown beside the work rather than as a conversation.
 * -------------------------------------------------------------------------- */

export type RunStatus = 'idle' | 'thinking' | 'streaming' | 'waiting-permission';

export interface RunState {
  status: RunStatus;
  sessionId?: string;
  /** Most recent first. Capped — an unbounded list is a transcript. */
  trail: string[];
  error?: string;
}

export const IDLE_RUN: RunState = { status: 'idle', trail: [] };

/** How many activity lines are kept. Past this it stops being a summary. */
export const TRAIL_MAX = 12;

export function pushTrail(run: RunState, line: string): RunState {
  return { ...run, trail: [line, ...run.trail].slice(0, TRAIL_MAX) };
}

export const RUN_LABEL: Record<RunStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  streaming: 'building the interface',
  'waiting-permission': 'waiting on your decision',
};

/* -------------------------------------------------------------------------- *
 * Assembly
 *
 * The six beats of a context forming. Unchanged in shape, but they are now
 * REPORTS rather than a timed animation: each one advances when the thing it
 * describes has actually happened, which is the difference between a sequence
 * that explains and one that performs.
 * -------------------------------------------------------------------------- */

export type AssemblyBeat =
  'idle' | 'intention' | 'objective' | 'agents' | 'workspace' | 'panels' | 'proposal' | 'ready';

export const ASSEMBLY_ORDER: AssemblyBeat[] = [
  'intention',
  'objective',
  'agents',
  'workspace',
  'panels',
  'proposal',
  'ready',
];

/** Which beat a run status corresponds to, so the sequence tracks real work. */
export function beatFor(run: RunState, hasDocument: boolean): AssemblyBeat {
  if (run.error) return 'ready';
  if (hasDocument) return 'ready';
  switch (run.status) {
    case 'thinking':
      return 'objective';
    case 'waiting-permission':
      return 'agents';
    case 'streaming':
      return 'panels';
    default:
      return 'intention';
  }
}
