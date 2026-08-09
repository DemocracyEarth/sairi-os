import type { JSX } from 'react';

/**
 * The system glyphs.
 *
 * There were none before this: the shell's only mark was a coloured dot, which
 * works when hue carries meaning and says nothing once the system is
 * monochrome. The brief asks for "distinctive monochrome icons, little system
 * glyphs — the machine should have a personality", and personality in an icon
 * set comes from a consistent set of rules rather than from cleverness in any
 * one symbol.
 *
 * The rules here:
 *
 *   - a 16-unit grid, and every terminal lands on a whole unit
 *   - one stroke weight, 1.25, which holds up at 14px and does not go furry
 *     at 2× the way hairlines do
 *   - right angles and true circles only; no organic curves, no rounded caps
 *   - `currentColor`, always, so a glyph inherits the ink of its context and
 *     can never introduce a colour of its own
 *
 * That last rule is what keeps them from becoming decoration. An icon set with
 * its own palette is a second visual language competing with the first.
 *
 * Drawn by hand rather than pulled from a library: an icon dependency would be
 * a runtime dependency in a project that justifies every one of them, and no
 * general-purpose set is cut to these rules anyway.
 */

export type GlyphName =
  'context' | 'action' | 'agent' | 'system' | 'return' | 'mic' | 'command' | 'empty';

export function Glyph({
  name,
  size = 14,
  className,
}: {
  name: GlyphName;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeWidth={1.25}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<GlyphName, JSX.Element> = {
  /* A context: the convergence idea again, at 16 units. A provisional frame
     with a settled core — the same figure as the brand mark, so the mark reads
     as "a context" rather than as a logo bolted on. */
  context: (
    <>
      <rect height="12" strokeDasharray="2 1.6" width="12" x="2" y="2" />
      <rect fill="currentColor" height="4" stroke="none" width="4" x="6" y="6" />
    </>
  ),

  /* An action: a rule that turns. Not a play triangle, which reads as media,
     and not a chevron, which reads as navigation. */
  action: (
    <>
      <path d="M3 4h6a3 3 0 0 1 3 3v4" />
      <path d="M9.5 8.5 12 11.5 14.5 8.5" />
    </>
  ),

  /* An agent: a ring with a gap, because an agent is a process rather than a
     thing — the gap is where the work is still open. */
  agent: (
    <>
      <path d="M13 8a5 5 0 1 1-2.2-4.15" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),

  /* System: two travelling controls on a rail. A gear at 14px is a smudge, and
     sliders are what an instrument panel actually has. */
  system: (
    <>
      <path d="M2 5.5h12M2 10.5h12" />
      <rect fill="currentColor" height="4" stroke="none" width="2.5" x="4.5" y="3.5" />
      <rect fill="currentColor" height="4" stroke="none" width="2.5" x="9" y="8.5" />
    </>
  ),

  /* The return key, for the row that Enter will run. */
  return: (
    <>
      <path d="M13 4v4.5H4" />
      <path d="M6.5 6 4 8.5 6.5 11" />
    </>
  ),

  /* A microphone: a capsule and a stand, the one place a capsule is right. */
  mic: (
    <>
      <rect height="7" rx="1.75" width="3.5" x="6.25" y="2" />
      <path d="M4 8a4 4 0 0 0 8 0M8 12v2" />
    </>
  ),

  /* The command key, so the keyboard hint is a mark rather than a character
     the font may not have. */
  command: (
    <path d="M6 6h4v4H6zM6 6V4.5A1.5 1.5 0 1 0 4.5 6H6zm4 0V4.5A1.5 1.5 0 1 1 11.5 6H10zm-4 4v1.5A1.5 1.5 0 1 1 4.5 10H6zm4 0v1.5a1.5 1.5 0 1 0 1.5-1.5H10z" />
  ),

  /* An empty state: a frame with nothing in it, drawn light. Charming rather
     than apologetic — it says "this is a place for something", which is what
     an empty state is for. */
  empty: (
    <>
      <rect height="10" strokeDasharray="2 2" width="12" x="2" y="3" />
      <path d="M5.5 8h5" opacity="0.5" />
    </>
  ),
};
