import type { JSX } from 'react';
import { Glyph, type GlyphName } from './Glyph.js';
import type { Match } from './palette.js';

/**
 * The command list, above the intent field.
 *
 * Not a modal. A palette that takes the screen is a second place to be, and the
 * point of putting commands in the intent field was to avoid exactly that — the
 * list grows upward out of the field that summoned it and collapses back into
 * it, which is the motion explaining where it came from.
 *
 * The field keeps focus throughout. This is a `listbox` the input owns via
 * `aria-activedescendant`, so a screen reader hears the highlighted command
 * change while the caret never moves.
 */

const GLYPH: Record<Match['command']['kind'], GlyphName> = {
  context: 'context',
  action: 'action',
  agent: 'agent',
  system: 'system',
};

export function CommandList({
  matches,
  selected,
  onHover,
  onRun,
  listId,
}: {
  matches: readonly Match[];
  /** -1 when nothing is highlighted, which is the normal state for prose. */
  selected: number;
  onHover: (index: number) => void;
  onRun: (index: number) => void;
  listId: string;
}): JSX.Element | null {
  if (matches.length === 0) return null;

  return (
    <ul className="s-pal" id={listId} role="listbox" aria-label="Commands">
      {matches.map((match, i) => (
        <li
          aria-selected={i === selected}
          className={`s-pal__row${i === selected ? ' is-on' : ''}`}
          id={`${listId}-${i}`}
          key={match.command.id}
          role="option"
          // Pointer-down rather than click: the input must not lose focus
          // before the command runs, or the field blurs and the list closes
          // out from under the pointer.
          onPointerDown={(e) => {
            e.preventDefault();
            onRun(i);
          }}
          onPointerEnter={() => onHover(i)}
        >
          <Glyph className="s-pal__glyph" name={GLYPH[match.command.kind]} />
          <span className="s-pal__title">{highlight(match)}</span>
          {match.command.hint && <span className="s-pal__hint">{match.command.hint}</span>}
          {i === selected && <Glyph className="s-pal__enter" name="return" size={12} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Marks the characters that matched.
 *
 * Built from the index list the matcher already produced rather than by
 * searching the title again — the two would drift, and the emphasis would then
 * be telling the user something different from what the ranking used.
 */
function highlight(match: Match): JSX.Element[] {
  const hits = new Set(match.hits);
  const out: JSX.Element[] = [];
  let run = '';
  let runHit = false;

  const flush = (key: number): void => {
    if (!run) return;
    out.push(
      runHit ? (
        <b className="s-pal__hit" key={key}>
          {run}
        </b>
      ) : (
        <span key={key}>{run}</span>
      ),
    );
    run = '';
  };

  for (let i = 0; i < match.command.title.length; i += 1) {
    const isHit = hits.has(i);
    if (isHit !== runHit) {
      flush(i);
      runHit = isHit;
    }
    run += match.command.title[i];
  }
  flush(match.command.title.length);
  return out;
}
