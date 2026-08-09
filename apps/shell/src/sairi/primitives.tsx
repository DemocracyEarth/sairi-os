import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';
import { isReturning, standing, trackRecord, type AgentRecord } from './roster.js';
import { CERTAINTY_VALUE, RUN_LABEL, type Certainty, type RunState } from './state.js';

/**
 * The Sairi primitive set.
 *
 * Composable pieces, not page fragments. Every lens in contexts/ is built from
 * these, which is what keeps four very different workspaces feeling like one
 * operating system.
 */

/* ------------------------------------------------------------------------ *
 * ContextSurface — the certainty-aware panel
 *
 * The single most important component here. It does not take a "variant" or a
 * "style"; it takes a CERTAINTY, and its border, fill, glow, elevation, ink and
 * vertical offset all derive from that one number through the --c-* tokens.
 *
 * So a hypothesis and a conclusion are visually different kinds of object
 * without any caller deciding how. That is the whole convergence idea, and it
 * lives in about fifteen lines of CSS.
 * ------------------------------------------------------------------------ */

export interface ContextSurfaceProps {
  title?: string;
  /** Small label above the title: what kind of thing this is. */
  kind?: string;
  certainty?: Certainty;
  /** Grid span at desktop, 1..12. */
  span?: number;
  /** Who produced it. Rendered as a provenance mark. */
  author?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Stagger index for the assembly entrance. */
  index?: number;
  className?: string;
}

export function ContextSurface({
  title,
  kind,
  certainty = 'forming',
  span = 4,
  author,
  actions,
  children,
  index = 0,
  className = '',
}: ContextSurfaceProps): JSX.Element {
  const style = {
    '--certainty': CERTAINTY_VALUE[certainty],
    '--span': span,
    '--i': index,
  } as CSSProperties;

  return (
    <section
      className={`s-surface s-surface--${certainty} ${className}`}
      data-certainty={certainty}
      style={style}
    >
      {(title || actions) && (
        <header className="s-surface__head">
          <div className="s-surface__heading">
            {kind && <span className="s-surface__kind">{kind}</span>}
            {title && <h3 className="s-surface__title">{title}</h3>}
          </div>
          <div className="s-surface__tools">
            {author && (
              <span className="s-surface__author" title={`Produced by ${author}`}>
                {author}
              </span>
            )}
            {actions}
          </div>
        </header>
      )}
      <div className="s-surface__body">{children}</div>
      {/* Provisional surfaces get a moving edge: the panel is still thinking. */}
      {certainty === 'provisional' && <span aria-hidden="true" className="s-surface__seeking" />}
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * StatusOrb — a small living indicator
 * ------------------------------------------------------------------------ */

export function StatusOrb({
  pulse = false,
  size = 8,
  label,
}: {
  pulse?: boolean;
  size?: number;
  label?: string;
}): JSX.Element {
  return (
    <span
      aria-label={label}
      className={`s-orb${pulse ? ' s-orb--pulse' : ''}`}
      role={label ? 'img' : undefined}
      style={{ '--orb': `${size}px` } as CSSProperties}
    />
  );
}

/* ------------------------------------------------------------------------ *
 * AgentPresence — an agent as a collaborator, not an avatar
 *
 * Role, current task, progress, last output, and controls. Never a chat bubble:
 * the whole point is that agents are working inside the context rather than
 * talking beside it.
 * ------------------------------------------------------------------------ */

/**
 * The live agent session.
 *
 * This replaced `AgentPresence`, which drew five named colleagues — a Source
 * librarian, a Metrologist — each with a role, a task and a progress bar. They
 * were fixtures. A context has ONE agent session, and what it actually emits is
 * a status and a trail of things it did.
 *
 * The trail is an activity log and deliberately not a transcript: newest first,
 * capped, and phrased as actions rather than as speech. The moment it reads as
 * dialogue this has become the chat window invariant 2 forbids.
 */
export function RunPresence({ run }: { run: RunState }): JSX.Element {
  const busy = run.status === 'thinking' || run.status === 'streaming';
  const needsYou = run.status === 'waiting-permission';

  return (
    <article className={`s-run${needsYou ? ' s-run--attention' : ''}`}>
      <div className="s-run__top">
        <span className="s-run__ring" data-status={run.status}>
          <StatusOrb pulse={busy} size={7} />
        </span>
        <span className="s-run__status">{RUN_LABEL[run.status]}</span>
      </div>

      {run.error && <p className="s-run__error">{run.error}</p>}

      {run.trail.length > 0 && (
        <ol className="s-run__trail">
          {run.trail.map((line, i) => (
            <li className="s-run__line" key={`${i}-${line.slice(0, 24)}`}>
              {line}
            </li>
          ))}
        </ol>
      )}

      {run.trail.length === 0 && !run.error && run.status === 'idle' && (
        <p className="s-run__quiet">Nothing running. State an intention to begin.</p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------------ *
 * Continuity — what this agent brings with it
 *
 * The visible half of roster.ts. Two things, and the second is the one that
 * matters: where this agent has worked, and exactly what it still believes as a
 * result. Every standing note names the context that produced it and can be
 * retired on the spot.
 *
 * That is deliberate. Compounding memory is easy to sell and hard to trust —
 * an agent that "learns about you" and never shows its working is a black box
 * you are asked to like. So the interface treats accumulated belief the way the
 * rest of this system treats a privileged action: visible, attributable, and
 * refusable.
 *
 * Collapsed by default, because the present tense is what an agent card is for.
 * ------------------------------------------------------------------------ */

export function Continuity({
  record,
  kind,
  onRetireNote,
}: {
  record: AgentRecord;
  /** The kind of context it is working in now, so continuity can say "again". */
  kind?: string;
  onRetireNote?: (agentId: string, noteId: string, retired: boolean) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const track = trackRecord(record);
  const live = standing(record);
  if (track.engagements === 0 && record.notes.length === 0) return null;

  const again = kind ? isReturning(record, kind) : false;
  const settled = track.accepted + track.revised + track.rejected;

  return (
    <div className="s-cont">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="s-cont__grip"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span aria-hidden="true" className={`s-cont__caret${open ? ' is-open' : ''}`} />
        <span className="s-cont__summary">
          {again && <span className="s-cont__again">worked this before</span>}
          {track.engagements === 1 ? '1 context' : `${track.engagements} contexts`}
          {/* No rate until something has settled: 0 of 0 would render as a
              track record of failure rather than as an agent on its first job. */}
          {settled > 0 && ` · ${track.accepted} of ${settled} accepted`}
          {live.length > 0 && ` · ${live.length} carried`}
        </span>
      </button>

      <div className="s-cont__panel" hidden={!open} id={panelId}>
        {record.engagements.length > 0 && (
          <>
            <h4 className="s-cont__heading">Where it has worked</h4>
            <ul className="s-cont__history">
              {record.engagements.map((e) => (
                <li className="s-cont__engagement" key={e.contextId}>
                  <span className={`s-cont__outcome s-cont__outcome--${e.outcome}`}>
                    {e.outcome}
                  </span>
                  <span className="s-cont__where">
                    <span className="s-cont__intention">{e.intention}</span>
                    <span className="s-cont__contribution">{e.contribution}</span>
                  </span>
                  <span className="s-cont__when">
                    {e.outcome === 'ongoing' ? 'now' : `${e.daysAgo}d`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {record.notes.length > 0 && (
          <>
            <h4 className="s-cont__heading">
              What it carries forward
              <span className="s-cont__note-hint">travels into every new context</span>
            </h4>
            <ul className="s-cont__notes">
              {record.notes.map((n) => {
                const source = record.engagements.find((e) => e.contextId === n.from);
                return (
                  <li className={`s-cont__note${n.retired ? ' is-retired' : ''}`} key={n.id}>
                    <p className="s-cont__note-text">{n.text}</p>
                    <p className="s-cont__note-foot">
                      <span className="s-cont__note-from">
                        {/* Provenance is not decoration: a note you cannot
                            attribute is one you cannot evaluate. */}
                        from “{source?.intention ?? n.from}”
                      </span>
                      {onRetireNote && (
                        <button
                          className="s-mini"
                          onClick={() => onRetireNote(record.id, n.id, !n.retired)}
                          type="button"
                        >
                          {n.retired ? 'Restore' : 'Retire'}
                        </button>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * ConvergenceMeter — the context's epistemic position, made visible
 *
 * Reads left (exploring) to right (decided). This is the legend for the whole
 * convergence idea: once a viewer connects this meter to the panels tightening,
 * the layout becomes readable.
 * ------------------------------------------------------------------------ */

export function ConvergenceMeter({ value }: { value: number }): JSX.Element {
  const pct = Math.round(value * 100);
  const label = value < 0.3 ? 'exploring' : value < 0.7 ? 'converging' : 'decided';
  return (
    <div
      aria-label={`Convergence: ${label}, ${pct} percent`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className="s-conv"
      role="meter"
      style={{ '--v': value } as CSSProperties}
    >
      <span className="s-conv__label">{label}</span>
      <span className="s-conv__rail">
        <span className="s-conv__fill" />
        <span className="s-conv__meridian" />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------------ */

export function Rule(): JSX.Element {
  return <span aria-hidden="true" className="s-rule" />;
}

export function Metric({
  value,
  label,
  trend,
}: {
  value: string;
  label: string;
  trend?: 'up' | 'down' | 'flat';
}): JSX.Element {
  return (
    <div className="s-metric">
      <span className="s-metric__value">
        {value}
        {trend && (
          <span className={`s-metric__trend s-metric__trend--${trend}`} aria-hidden="true" />
        )}
      </span>
      <span className="s-metric__label">{label}</span>
    </div>
  );
}

export function Tag({
  children,
  solid = false,
}: {
  children: ReactNode;
  solid?: boolean;
}): JSX.Element {
  return <span className={`s-tag${solid ? ' s-tag--solid' : ''}`}>{children}</span>;
}

/** Empty state. Never a shrug — always says what would fill it. */
export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="s-empty">{children}</p>;
}

/** Skeleton used while a lens is still being produced by an agent. */
export function Forming({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div aria-hidden="true" className="s-forming">
      {Array.from({ length: rows }, (_, i) => (
        <span className="s-forming__row" key={i} style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * useCountUp — numbers arrive rather than appear
 *
 * Web Animations would be wrong here (it animates style, not text), so this is
 * a short rAF that stops as soon as it lands. Bounded and self-cancelling: no
 * standing loop, which the performance budget forbids.
 * ------------------------------------------------------------------------ */

export function useCountUp(target: number, ms = 700, run = true): number {
  const [value, setValue] = useState(run ? 0 : target);
  const frame = useRef(0);

  useEffect(() => {
    if (!run) {
      setValue(target);
      return;
    }
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(target);
      return;
    }
    const started = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / ms);
      // easeOutCubic: fast then settles, matching --ease-out.
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, ms, run]);

  return value;
}
