import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { StatusOrb, hue } from './primitives.js';
import { BEAT_MS, KIND_LABEL, nextBeat, type AssemblyBeat, type SairiContext } from './state.js';

/**
 * The signature sequence: a context assembling itself.
 *
 * Six beats, each a thing that actually happened, so a viewer can name what
 * Sairi is doing at any frame. That is the line between cinematic and
 * gratuitous — the animation is an explanation, not a transition.
 *
 *   intention   the user's words land, and are treated as the context's name
 *   objective   Sairi states what it understands the goal to be
 *   agents      the agents it selected activate, one at a time
 *   workspace   the frame forms
 *   panels      tools and information arrive, staggered
 *   proposal    Sairi proposes the first useful action
 *
 * It is skippable. A sequence you cannot escape is a cutscene, and nobody wants
 * a cutscene in an operating system on the fiftieth run — click, press Escape or
 * hit any key and it resolves immediately.
 */

export function Assembly({
  context,
  beat,
  onAdvance,
  onSkip,
}: {
  context: SairiContext;
  beat: AssemblyBeat;
  onAdvance: (next: AssemblyBeat) => void;
  onSkip: () => void;
}): JSX.Element | null {
  const [shown, setShown] = useState(0);

  // Drive the beats. One timer at a time, cleared on every change, so an
  // interrupted sequence cannot leave a timer running behind the workspace.
  useEffect(() => {
    if (beat === 'idle' || beat === 'ready') return;
    const id = setTimeout(() => onAdvance(nextBeat(beat)), BEAT_MS[beat]);
    return () => clearTimeout(id);
  }, [beat, onAdvance]);

  // Agents activate in sequence rather than all at once: it reads as selection,
  // which is what it is, instead of a group fade-in.
  useEffect(() => {
    if (beat !== 'agents') return;
    setShown(0);
    const timers = context.agents.map((_, i) =>
      setTimeout(() => setShown((n) => Math.max(n, i + 1)), 90 + i * 130),
    );
    return () => timers.forEach(clearTimeout);
  }, [beat, context.agents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  if (beat === 'idle' || beat === 'ready') return null;

  const reached = (b: AssemblyBeat): boolean => {
    const order: AssemblyBeat[] = [
      'intention',
      'objective',
      'agents',
      'workspace',
      'panels',
      'proposal',
    ];
    return order.indexOf(beat) >= order.indexOf(b);
  };

  return (
    <div
      aria-label="Sairi is assembling this context"
      aria-live="polite"
      className="s-assembly"
      role="status"
      style={{ '--accent': hue(context.hue) } as CSSProperties}
    >
      <button className="s-assembly__skip" onClick={onSkip} type="button">
        Skip
      </button>

      <div className="s-assembly__stage">
        {/* 1 — the intention */}
        <p className={`s-assembly__intent${reached('intention') ? ' is-in' : ''}`}>
          <span className="s-assembly__quote">“</span>
          {context.intention}
          <span className="s-assembly__quote">”</span>
        </p>

        {/* 2 — Sairi's reading of the objective */}
        <div className={`s-assembly__row${reached('objective') ? ' is-in' : ''}`}>
          <span className="s-assembly__step">objective</span>
          <p className="s-assembly__objective">{context.objective}</p>
        </div>

        {/* 3 — the agents it chose */}
        <div className={`s-assembly__row${reached('agents') ? ' is-in' : ''}`}>
          <span className="s-assembly__step">{KIND_LABEL[context.kind].toLowerCase()} agents</span>
          <ul className="s-assembly__agents">
            {context.agents.map((a, i) => (
              <li
                className={`s-assembly__agent${i < shown || reached('workspace') ? ' is-in' : ''}`}
                key={a.id}
                style={{ '--accent': hue(a.hue) } as CSSProperties}
              >
                <StatusOrb hue={a.hue} pulse size={6} />
                <span className="s-assembly__agentrole">{a.role}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 4/5 — the frame, then the panels arriving */}
        <div className={`s-assembly__row${reached('workspace') ? ' is-in' : ''}`}>
          <span className="s-assembly__step">workspace</span>
          <div className="s-assembly__frame">
            {context.panels.map((p, i) => (
              <span
                className={`s-assembly__slot${reached('panels') ? ' is-in' : ''}`}
                data-certainty={p.certainty}
                key={p.id}
                style={{ '--i': i, '--span': p.span } as CSSProperties}
                title={p.title}
              />
            ))}
          </div>
        </div>

        {/* 6 — the first useful action */}
        <div
          className={`s-assembly__row s-assembly__row--last${reached('proposal') ? ' is-in' : ''}`}
        >
          <span className="s-assembly__step">first action</span>
          <p className="s-assembly__proposal">{context.proposal.title}</p>
        </div>
      </div>
    </div>
  );
}
