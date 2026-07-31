import type { JSX } from 'react';
import type { Context, ContextType } from '@sairios/context-schema';

/**
 * The context map.
 *
 * The home view of SairiOS. Contexts are grouped by type, not by application,
 * folder or recency, because type is what tells you how to treat the work:
 * bounded, ongoing, or reusable.
 */

const GROUPS: { type: ContextType; heading: string; blurb: string }[] = [
  { type: 'ephemeral', heading: 'Ephemeral', blurb: 'Bounded tasks. Archived when they complete.' },
  {
    type: 'persistent',
    heading: 'Persistent',
    blurb: 'Long-lived workspaces that keep their memory.',
  },
  {
    type: 'crystallized',
    heading: 'Crystallized',
    blurb: 'Stabilized workflows you can run again.',
  },
];

export interface ContextMapProps {
  contexts: Context[];
  onOpen: (context: Context) => void;
  showArchived: boolean;
}

export function ContextMap({ contexts, onOpen, showArchived }: ContextMapProps): JSX.Element {
  const visible = showArchived ? contexts : contexts.filter((c) => c.status !== 'archived');

  return (
    <div>
      {GROUPS.map((group) => {
        const items = visible.filter((c) => c.type === group.type);
        return (
          <section className="map__group" key={group.type}>
            <h2 className="map__heading">
              {group.heading}
              <span className="map__count">{items.length}</span>
            </h2>
            {items.length === 0 ? (
              <p className="sairi-empty">{group.blurb}</p>
            ) : (
              <div className="map__grid">
                {items.map((context) => (
                  <ContextCard context={context} key={context.id} onOpen={onOpen} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ContextCard({
  context,
  onOpen,
}: {
  context: Context;
  onOpen: (context: Context) => void;
}): JSX.Element {
  return (
    <button className={`card card--${context.type}`} onClick={() => onOpen(context)} type="button">
      <div className="card__top">
        <h3 className="card__name">{context.name}</h3>
        <span className={`sairi-badge sairi-badge--${context.type}`}>{context.type}</span>
      </div>
      <p className="card__objective" title={context.objective}>
        {context.objective || 'No objective recorded.'}
      </p>
      <div className="card__meta">
        <span>{context.status}</span>
        <span>{relativeTime(context.updatedAt)}</span>
      </div>
    </button>
  );
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
