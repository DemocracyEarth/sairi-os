/**
 * The Sairi OS domain model, and the convergence machine that drives it.
 *
 * The idea this file exists to serve: a workspace's SHAPE is a function of how
 * certain its contents are. Panels are born provisional and earn solidity as
 * agents work. So `certainty` is not a progress bar — it is the input the whole
 * visual system reads, and layout, colour, elevation and type weight all fall
 * out of it.
 *
 * Everything here is deterministic and offline. No network, no model, no timers
 * beyond the ones the assembly sequence needs. That matches the rest of this
 * project: mock mode has to work with no credentials at all, and a keynote
 * should never depend on someone's wifi.
 */

export type Spectral = 'blue' | 'cyan' | 'violet' | 'magenta' | 'coral' | 'amber' | 'mint';

/** Where a panel sits on the convergence axis. Drives its whole appearance. */
export type Certainty = 'provisional' | 'forming' | 'resolved';

export const CERTAINTY_VALUE: Record<Certainty, number> = {
  provisional: 0.12,
  forming: 0.55,
  resolved: 1,
};

export type AgentStatus = 'idle' | 'working' | 'awaiting-approval' | 'done' | 'blocked';

export interface Agent {
  id: string;
  /** What it is, in the user's language. Not a model name. */
  role: string;
  /** What it is doing right now, present tense. */
  task: string;
  status: AgentStatus;
  /** 0..1. Only meaningful while working. */
  progress: number;
  hue: Spectral;
  /** The last thing it produced, one line. */
  output?: string;
  /** Panel ids this agent authored, for the provenance thread. */
  produced: string[];
}

/**
 * A panel in the workspace.
 *
 * `lens` names WHAT KIND of interface this is — a source list, a knowledge
 * graph, a map, a canvas. This is the mechanism by which four contexts produce
 * four visibly different workspaces rather than one card grid with different
 * labels: a context declares a set of lenses, and the lens decides its own
 * interior completely.
 */
export interface Panel {
  id: string;
  title: string;
  lens: LensKind;
  certainty: Certainty;
  /** Column span at desktop width, 1..12. Provisional panels are wider. */
  span: number;
  /** Which agent made it. Drives the provenance thread. */
  author?: string;
  /** Arbitrary lens-specific payload; each lens narrows this itself. */
  data: unknown;
}

export type LensKind =
  // research
  | 'sources'
  | 'knowledge-map'
  | 'comparison'
  | 'timeline'
  // incident
  | 'logs'
  | 'health'
  | 'hypotheses'
  | 'sequence'
  // travel
  | 'map'
  | 'itinerary'
  | 'constraints'
  | 'ledger'
  // design
  | 'canvas'
  | 'insights'
  | 'concepts'
  | 'artifact';

export interface SairiContext {
  id: string;
  /** The intention, in the user's words. This is the context's real name. */
  intention: string;
  /** Sairi's reading of the objective. Shown during assembly. */
  objective: string;
  kind: 'research' | 'incident' | 'travel' | 'design';
  hue: Spectral;
  agents: Agent[];
  panels: Panel[];
  /** What Sairi proposes doing next. The first useful action. */
  proposal: { title: string; detail: string; verb: string };
  /** Minutes since last activity. Drives navigator brightness. */
  lastActive: number;
}

/**
 * A broker-shaped id for a Sairi context.
 *
 * The permission broker attributes every request to a context and requires
 * `ctx_` followed by 32 hex characters, because a grant that cannot be
 * attributed cannot be scoped or revoked. These contexts are fixtures with ids
 * like `ctx-research`, so they need mapping.
 *
 * Deterministic rather than random, so "allow for this context" survives a
 * reload — a grant that silently forgot itself would train someone to click
 * allow, which is the prompt-fatigue failure SECURITY.md names.
 *
 * The honest wart: these ids name contexts the context service has never heard
 * of, so the audit log will carry entries for them. That is a consequence of
 * the Sairi surface being a prototype that does not persist, and it goes away
 * when it does.
 */
export function brokerContextId(id: string): string {
  // FNV-1a, four times over with different offsets, to fill 32 hex digits.
  // Not a security hash and not used as one: this is a stable name, and the
  // only thing at stake in a collision is two fixtures sharing a grant.
  let out = '';
  for (let round = 0; round < 4; round += 1) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return `ctx_${out}`;
}

/** Aggregate convergence: how close this context is to an answer, 0..1. */
export function convergence(context: SairiContext): number {
  if (context.panels.length === 0) return 0;
  const total = context.panels.reduce((sum, p) => sum + CERTAINTY_VALUE[p.certainty], 0);
  return total / context.panels.length;
}

/**
 * Assembly: the six beats of a context forming.
 *
 * Deliberately a state machine rather than a fixed animation. Each beat is a
 * thing that has actually happened, so the sequence stays legible — a viewer
 * can name what Sairi is doing at any frame, which is the difference between
 * cinematic and gratuitous.
 */
export type AssemblyBeat =
  | 'idle'
  | 'intention' // the user's words land
  | 'objective' // Sairi states the objective
  | 'agents' // relevant agents activate
  | 'workspace' // the frame forms
  | 'panels' // tools and information arrive, staggered
  | 'proposal' // Sairi proposes the first action
  | 'ready';

export const ASSEMBLY_ORDER: AssemblyBeat[] = [
  'intention',
  'objective',
  'agents',
  'workspace',
  'panels',
  'proposal',
  'ready',
];

/** Milliseconds each beat holds before the next. Tuned by eye, not by formula. */
export const BEAT_MS: Record<AssemblyBeat, number> = {
  idle: 0,
  intention: 620,
  objective: 780,
  agents: 700,
  workspace: 520,
  panels: 900,
  proposal: 620,
  ready: 0,
};

export function nextBeat(beat: AssemblyBeat): AssemblyBeat {
  const i = ASSEMBLY_ORDER.indexOf(beat);
  if (i < 0 || i === ASSEMBLY_ORDER.length - 1) return 'ready';
  return ASSEMBLY_ORDER[i + 1] as AssemblyBeat;
}

/**
 * Picks a context shape from an intention.
 *
 * Keyword matching, and deliberately so: this is a prototype of the INTERFACE,
 * not of the router. When a real model is wired in it returns the objective and
 * the panel set, and this function goes away. Marked here so nobody mistakes it
 * for intelligence.
 */
export function readIntention(text: string): SairiContext['kind'] {
  const t = text.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => t.includes(w));

  if (has('fail', 'error', 'bug', 'incident', 'outage', 'debug', 'broken', 'checkout', 'payment'))
    return 'incident';
  if (has('trip', 'travel', 'japan', 'flight', 'itinerary', 'visit', 'tokyo', 'holiday'))
    return 'travel';
  if (has('design', 'launch', 'product', 'brand', 'concept', 'strategy', 'campaign'))
    return 'design';
  return 'research';
}

export const KIND_HUE: Record<SairiContext['kind'], Spectral> = {
  research: 'violet',
  incident: 'coral',
  travel: 'cyan',
  design: 'amber',
};

export const KIND_LABEL: Record<SairiContext['kind'], string> = {
  research: 'Research',
  incident: 'Problem solving',
  travel: 'Travel',
  design: 'Product design',
};
