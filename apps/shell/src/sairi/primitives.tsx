import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { CERTAINTY_VALUE, type Agent, type Certainty, type Spectral } from './state.js';

/**
 * The Sairi primitive set.
 *
 * Composable pieces, not page fragments. Every lens in contexts/ is built from
 * these, which is what keeps four very different workspaces feeling like one
 * operating system.
 */

export function hue(h: Spectral): string {
  return `var(--${h})`;
}

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
  accent?: Spectral;
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
  accent = 'blue',
  span = 4,
  author,
  actions,
  children,
  index = 0,
  className = '',
}: ContextSurfaceProps): JSX.Element {
  const style = {
    '--certainty': CERTAINTY_VALUE[certainty],
    '--accent': hue(accent),
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
  hue: h = 'cyan',
  pulse = false,
  size = 8,
  label,
}: {
  hue?: Spectral;
  pulse?: boolean;
  size?: number;
  label?: string;
}): JSX.Element {
  return (
    <span
      aria-label={label}
      className={`s-orb${pulse ? ' s-orb--pulse' : ''}`}
      role={label ? 'img' : undefined}
      style={{ '--accent': hue(h), '--orb': `${size}px` } as CSSProperties}
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

export function AgentPresence({
  agent,
  onPause,
  onRedirect,
  compact = false,
}: {
  agent: Agent;
  onPause?: (id: string) => void;
  onRedirect?: (id: string) => void;
  compact?: boolean;
}): JSX.Element {
  const working = agent.status === 'working';
  const needsYou = agent.status === 'awaiting-approval';

  return (
    <article
      className={`s-agent${compact ? ' s-agent--compact' : ''}${needsYou ? ' s-agent--attention' : ''}`}
      style={{ '--accent': hue(agent.hue) } as CSSProperties}
    >
      <div className="s-agent__top">
        <span className="s-agent__ring" data-status={agent.status}>
          <StatusOrb hue={agent.hue} pulse={working} size={7} />
        </span>
        <div className="s-agent__id">
          <span className="s-agent__role">{agent.role}</span>
          <span className="s-agent__task">{agent.task}</span>
        </div>
        {!compact && (onPause || onRedirect) && (
          <div className="s-agent__controls">
            {onPause && (
              <button
                className="s-mini"
                onClick={() => onPause(agent.id)}
                title={working ? 'Pause this agent' : 'Resume this agent'}
                type="button"
              >
                {working ? 'Pause' : 'Resume'}
              </button>
            )}
            {onRedirect && (
              <button
                className="s-mini"
                onClick={() => onRedirect(agent.id)}
                title="Redirect this agent"
                type="button"
              >
                Redirect
              </button>
            )}
          </div>
        )}
      </div>

      {working && (
        <div
          aria-label={`${agent.role} progress`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(agent.progress * 100)}
          className="s-agent__track"
          role="progressbar"
        >
          <span className="s-agent__fill" style={{ width: `${agent.progress * 100}%` }} />
        </div>
      )}

      {agent.output && !compact && <p className="s-agent__output">{agent.output}</p>}

      {needsYou && (
        <p className="s-agent__flag">
          <StatusOrb hue="amber" pulse size={6} /> waiting on your decision
        </p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------------ *
 * ConvergenceMeter — the context's epistemic position, made visible
 *
 * Reads left (exploring) to right (decided). This is the legend for the whole
 * convergence idea: once a viewer connects this meter to the panels tightening,
 * the layout becomes readable.
 * ------------------------------------------------------------------------ */

export function ConvergenceMeter({
  value,
  accent = 'blue',
}: {
  value: number;
  accent?: Spectral;
}): JSX.Element {
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
      style={{ '--accent': hue(accent), '--v': value } as CSSProperties}
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

export function GlowDivider({ accent = 'blue' }: { accent?: Spectral }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="s-divider"
      style={{ '--accent': hue(accent) } as CSSProperties}
    />
  );
}

export function Metric({
  value,
  label,
  accent,
  trend,
}: {
  value: string;
  label: string;
  accent?: Spectral;
  trend?: 'up' | 'down' | 'flat';
}): JSX.Element {
  return (
    <div
      className="s-metric"
      style={accent ? ({ '--accent': hue(accent) } as CSSProperties) : undefined}
    >
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
  accent = 'blue',
  solid = false,
}: {
  children: ReactNode;
  accent?: Spectral;
  solid?: boolean;
}): JSX.Element {
  return (
    <span
      className={`s-tag${solid ? ' s-tag--solid' : ''}`}
      style={{ '--accent': hue(accent) } as CSSProperties}
    >
      {children}
    </span>
  );
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
