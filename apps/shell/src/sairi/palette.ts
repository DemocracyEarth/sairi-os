/**
 * The command palette, as a matching problem.
 *
 * ---------------------------------------------------------------------------
 * One field, two kinds of thing
 * ---------------------------------------------------------------------------
 * SairiOS already has a universal intent field: you say what you want to
 * accomplish and a workspace assembles. Adding a SECOND overlay for commands
 * would mean two places to type and a rule to remember about which is which —
 * exactly the "thirty destinations in a sidebar" the brief argues against.
 *
 * So the intent field IS the palette. Type, and anything that matches a command
 * is offered; type something that matches nothing and it stays what it always
 * was, an intention. Enter runs the highlighted command, or submits the
 * intention when nothing is highlighted. The field never changes mode and never
 * tells you that you used it wrong.
 *
 * That is also why matching has to be conservative. A palette that eagerly
 * fuzzy-matches would hijack "plan a trip to Japan" into some command
 * containing p, l, a, n — turning the primary interaction into a misfire. The
 * rules below are deliberately strict, and `palette.test.ts` pins the specific
 * intentions that must NOT be captured.
 */

export type CommandKind = 'context' | 'action' | 'agent' | 'system';

export interface Command {
  id: string;
  /** Imperative and short: what it does, in the user's language. */
  title: string;
  /** Where it applies, shown right-aligned. */
  hint?: string;
  kind: CommandKind;
  /** Extra words that should find this command but are not worth showing. */
  keywords?: string[];
  run: () => void;
}

export interface Match {
  command: Command;
  /** Character indices in `title` that matched, for highlighting. */
  hits: number[];
  /**
   * 3 title prefix · 2 word prefix · 1 scattered word hits.
   *
   * Carried separately from `score` because `score` folds in a length penalty
   * for ranking, which pushes a long tier-2 title below a short tier-1 one. A
   * first attempt inferred the tier from the score and got "dark" wrong.
   */
  tier: 1 | 2 | 3;
  score: number;
}

/**
 * Scores one command against a query.
 *
 * Three tiers, and nothing below them:
 *
 *   3000  the title starts with the query
 *   2000  a WORD in the title starts with the query
 *   1000  every query word appears as a word-prefix somewhere, in order
 *
 * Note what is missing: scattered-character fuzzy matching. It is what makes a
 * palette feel clever in a demo and what makes this one dangerous, because this
 * field also carries free text. "launch strategy for a new product" should
 * assemble a context, not silently match "Switch to Latest".
 */
export function score(query: string, command: Command): Match | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const title = command.title.toLowerCase();

  if (title.startsWith(q)) {
    return { command, hits: range(0, q.length), tier: 3, score: 3000 - title.length };
  }

  const wordStart = wordStarts(title).find((i) => title.startsWith(q, i));
  if (wordStart !== undefined) {
    return {
      command,
      hits: range(wordStart, wordStart + q.length),
      tier: 2,
      score: 2000 - title.length,
    };
  }

  // Every word of the query must land on a word boundary, left to right.
  const words = q.split(/\s+/).filter(Boolean);
  const hits: number[] = [];
  let viaKeyword = false;
  let from = 0;
  for (const word of words) {
    const at = wordStarts(title).find((i) => i >= from && title.startsWith(word, i));
    if (at === undefined) {
      // Keywords are curated aliases — somebody decided that "anthropic" should
      // find "Connect a model". Matching one is a deliberate signal, not the
      // coincidence that tier 1 exists to distrust, so it is promoted.
      if (!command.keywords?.some((k) => k.toLowerCase().startsWith(word))) return undefined;
      viaKeyword = true;
      continue;
    }
    hits.push(...range(at, at + word.length));
    from = at + word.length;
  }
  if (!hits.length && !viaKeyword) return undefined;
  return { command, hits, tier: viaKeyword ? 2 : 1, score: 1000 - title.length };
}

function wordStarts(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (i === 0 || /[\s\-/·]/.test(text[i - 1] ?? '')) out.push(i);
  }
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

/**
 * The commands offered for a query.
 */
export function matchCommands(query: string, commands: readonly Command[], limit = 6): Match[] {
  const q = query.trim();
  if (q.length < 2) return [];

  return commands
    .map((c) => score(q, c))
    .filter((m): m is Match => m !== undefined)
    .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
    .slice(0, limit);
}

/**
 * Whether the top match may sit under the Enter key without being asked for.
 *
 * Showing a command and PRE-SELECTING one are different promises, and this is
 * the line between a palette that helps and a palette that steals the primary
 * interaction. The distinction that works is abbreviating versus writing:
 *
 *   "connect"                              47% of its title  — an abbreviation
 *   "dark"                                 16% of its title  — an abbreviation
 *   "Analyse recent quantum-computing…"    88% of its title  — prose
 *
 * Someone typing most of a command's title is usually not aiming at the
 * command; they are stating an intention that happens to resemble one, which is
 * exactly what happens when a context already exists for it. That case still
 * shows the row — going there instead of making a duplicate is useful — it just
 * requires an arrow key to say so.
 */
export function shouldAutoSelect(query: string, matches: readonly Match[]): boolean {
  const top = matches[0];
  if (!top) return false;
  // The weakest tier is a scatter of word hits; never presume on it.
  if (top.tier < 2) return false;
  const q = query.trim();
  return q.length / top.command.title.length < 0.6;
}

/**
 * The standing command set.
 *
 * Built from live state rather than declared statically, because the useful
 * commands in an operating system organised around contexts are mostly *about*
 * the contexts that exist right now. This is the "context over navigation"
 * argument made concrete: there is no menu of thirty destinations, there is a
 * field that knows what is currently true.
 */
/** The slice of a context the palette needs. Kept structural so the palette
 *  does not depend on the whole domain type. */
export interface PaletteContext {
  id: string;
  intention: string;
  kind: string;
}

export function buildCommands(input: {
  contexts: readonly PaletteContext[];
  activeId: string;
  onSwitch: (id: string) => void;
  onOpenSetup: () => void;
  onToggleTheme: () => void;
  /**
   * Runs the two mock agents through a handover, so it can be watched.
   *
   * Offered only when the bridge is in mock mode, because that is the only
   * configuration where these two agents exist. Explicitly labelled a demo:
   * the loop is real — a real file, a real digest, real approvals — but the
   * agents are deterministic fixtures, and calling that a capability would be
   * the kind of claim this project keeps out of its own documentation.
   */
  onHandoverDemo?: (() => void) | undefined;
  theme: 'light' | 'dark';
  proposal?: { title: string; verb: string };
  onProposal?: () => void;
}): Command[] {
  const commands: Command[] = [];

  for (const context of input.contexts) {
    if (context.id === input.activeId) continue;
    commands.push({
      id: `go:${context.id}`,
      title: `Go to ${context.intention}`,
      hint: 'context',
      kind: 'context',
      keywords: ['switch', 'open', context.kind],
      run: () => input.onSwitch(context.id),
    });
  }

  if (input.proposal && input.onProposal) {
    commands.push({
      id: 'proposal',
      title: input.proposal.verb,
      hint: input.proposal.title,
      kind: 'action',
      keywords: ['proposed', 'suggestion', 'next'],
      run: input.onProposal,
    });
  }

  commands.push({
    id: 'theme',
    // Names the destination, not the current state: "Dark appearance" is
    // ambiguous about whether it is a description or a switch.
    title: input.theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance',
    hint: 'system',
    kind: 'system',
    keywords: ['theme', 'appearance', 'dark', 'light', 'contrast'],
    run: input.onToggleTheme,
  });

  if (input.onHandoverDemo) {
    commands.push({
      id: 'handover',
      title: 'Watch two agents hand work over',
      hint: 'demo',
      kind: 'system',
      keywords: ['handover', 'relay', 'agents', 'demo', 'orchestrate'],
      run: input.onHandoverDemo,
    });
  }

  commands.push({
    id: 'setup',
    title: 'Connect a model',
    hint: 'system',
    kind: 'system',
    keywords: ['provider', 'anthropic', 'openai', 'api', 'key', 'setup'],
    run: input.onOpenSetup,
  });

  return commands;
}
