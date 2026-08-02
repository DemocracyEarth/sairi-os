import { useState, type FormEvent, type JSX } from 'react';
import type { Context, ContextType } from '@sairios/context-schema';
import { useLocale, useT, type Locale, type MessageKey } from '@sairios/ui-components';
import { Icon } from './icons.js';

/**
 * The context map.
 *
 * The home view: every context, grouped by type. Grouped by type rather than by
 * recency because the type is what tells you how to treat the work — bounded,
 * ongoing, or reusable — and that is the decision a person is actually making
 * when they look at this list.
 */

const GROUPS: {
  type: ContextType;
  titleKey: MessageKey;
  blurbKey: MessageKey;
  icon: JSX.Element;
}[] = [
  {
    type: 'ephemeral',
    titleKey: 'type.ephemeral.plural',
    blurbKey: 'type.ephemeral.blurb',
    icon: <Icon.clock size={14} />,
  },
  {
    type: 'persistent',
    titleKey: 'type.persistent.plural',
    blurbKey: 'type.persistent.blurb',
    icon: <Icon.infinity size={14} />,
  },
  {
    type: 'crystallized',
    titleKey: 'type.crystallized.plural',
    blurbKey: 'type.crystallized.blurb',
    icon: <Icon.crystal size={14} />,
  },
];

export function relativeTime(iso: string, t: ReturnType<typeof useT>, locale: Locale): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t('time.unknown');
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return t('time.now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('time.days', { n: days });
  // The four branches above are localized through t(); this one must be too,
  // or a date older than a month silently switches to the host's language.
  return new Date(iso).toLocaleDateString(locale);
}

export interface ContextMapWindowProps {
  contexts: Context[];
  showArchived: boolean;
  busy: boolean;
  onOpen: (context: Context) => void;
  onCreate: (intention: string, type: Exclude<ContextType, 'crystallized'>) => void;
  onNew: (type: Exclude<ContextType, 'crystallized'>) => void;
}

export function ContextMapWindow(props: ContextMapWindowProps): JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [value, setValue] = useState('');
  const [type, setType] = useState<Exclude<ContextType, 'crystallized'>>('ephemeral');

  const visible = props.showArchived
    ? props.contexts
    : props.contexts.filter((c) => c.status !== 'archived');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || props.busy) return;
    props.onCreate(trimmed, type);
    setValue('');
  };

  return (
    <div>
      <form className="intention" onSubmit={submit}>
        <label className="intention__label" htmlFor="intention-input">
          {t('intention.prompt')}
        </label>
        <div className="intention__row">
          <input
            autoComplete="off"
            className="intention__input"
            disabled={props.busy}
            id="intention-input"
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('intention.placeholder')}
            value={value}
          />
          <button
            className="btn btn--primary"
            disabled={props.busy || value.trim().length === 0}
            type="submit"
          >
            {props.busy ? t('intention.working') : t('intention.create')}
          </button>
        </div>
        <fieldset className="intention__types">
          <label className="intention__type">
            <input
              checked={type === 'ephemeral'}
              name="context-type"
              onChange={() => setType('ephemeral')}
              type="radio"
            />
            {t('intention.ephemeralOption')}
          </label>
          <label className="intention__type">
            <input
              checked={type === 'persistent'}
              name="context-type"
              onChange={() => setType('persistent')}
              type="radio"
            />
            {t('intention.persistentOption')}
          </label>
        </fieldset>
        <p className="intention__hint">{t('intention.voiceNote')}</p>
      </form>

      {GROUPS.map((group) => {
        const items = visible.filter((c) => c.type === group.type);
        return (
          <section className="group" key={group.type}>
            <header className="group__head">
              <span className="group__icon">{group.icon}</span>
              <h3 className="group__title">{t(group.titleKey)}</h3>
              <span className="group__blurb">{t(group.blurbKey)}</span>
              <span className="group__spacer" />
              {group.type !== 'crystallized' && (
                <button
                  className="btn btn--ghost"
                  onClick={() => props.onNew(group.type as 'ephemeral' | 'persistent')}
                  type="button"
                >
                  <Icon.plus size={11} /> {t('map.new')}
                </button>
              )}
            </header>

            {items.length === 0 ? (
              <p className="aside__muted">{t('map.empty')}</p>
            ) : (
              <div className="group__grid">
                {items.map((context) => (
                  <button
                    className="card"
                    key={context.id}
                    onClick={() => props.onOpen(context)}
                    type="button"
                  >
                    <div className="card__top">
                      <h4 className="card__name">{context.name}</h4>
                      <span className="group__spacer" />
                      <span className={`badge badge--${context.type}`}>
                        {t(`type.${context.type}` as MessageKey)}
                      </span>
                    </div>
                    <p className="card__objective" title={context.objective}>
                      {context.objective || t('map.noObjective')}
                    </p>
                    <div className="card__meta">
                      <span className={`dot dot--${dotFor(context.status)}`} />
                      <span>{t(`status.${context.status}` as MessageKey)}</span>
                      <span>·</span>
                      <span>
                        {t('map.updated', { time: relativeTime(context.updatedAt, t, locale) })}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <p className="aside__muted">{t('map.total', { count: visible.length })}</p>
    </div>
  );
}

export function dotFor(status: Context['status']): 'ok' | 'warn' | 'error' | 'idle' {
  switch (status) {
    case 'active':
      return 'ok';
    case 'waiting':
      return 'warn';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}
