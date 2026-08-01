import { useState, type JSX } from 'react';
import type { CrystallizationPreview } from '@sairios/context-schema';
import { useT } from '@sairios/ui-components';

/**
 * Crystallization preview.
 *
 * The user sees exactly what survives and exactly what is removed BEFORE the
 * template exists. A template is the artefact most likely to be shared, so the
 * moment it is created is the moment somebody must be able to check it.
 */

export interface CrystallizeDialogProps {
  preview: CrystallizationPreview;
  busy: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CrystallizeDialog(props: CrystallizeDialogProps): JSX.Element {
  const t = useT();
  const [name, setName] = useState(props.preview.proposedName);

  return (
    <div className="overlay" role="presentation">
      <div aria-modal="true" className="dialog" role="dialog">
        <header className="dialog__head">
          <h2 className="dialog__title">{t('crys.title')}</h2>
        </header>

        <div className="dialog__body">
          <p className="aside__muted" style={{ marginBottom: 'var(--sairi-space-4)' }}>
            {t('crys.intro')}
          </p>

          <label className="intention__label" htmlFor="template-name">
            {t('crys.name')}
          </label>
          <input
            className="intention__input"
            id="template-name"
            onChange={(event) => setName(event.target.value)}
            style={{ marginBottom: 'var(--sairi-space-4)', width: '100%' }}
            value={name}
          />

          <div className="split">
            <div>
              <h3 className="split__title split__title--keep">
                {t('crys.retained', { count: props.preview.retained.length })}
              </h3>
              <ul className="split__list">
                {props.preview.retained.map((item, i) => (
                  <li key={`keep-${i}`}>{item.label}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="split__title split__title--drop">
                {t('crys.removed', { count: props.preview.discarded.length })}
              </h3>
              {props.preview.discarded.length === 0 ? (
                <p className="aside__muted">{t('crys.nothingRemoved')}</p>
              ) : (
                <ul className="split__list">
                  {props.preview.discarded.map((item, i) => (
                    <li key={`drop-${i}`}>
                      {item.label}
                      <span className="split__reason">{item.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <footer className="dialog__foot">
          <button className="btn" disabled={props.busy} onClick={props.onCancel} type="button">
            {t('crys.cancel')}
          </button>
          <button
            className="btn btn--primary"
            disabled={props.busy || name.trim().length === 0}
            onClick={() => props.onConfirm(name.trim())}
            type="button"
          >
            {props.busy ? t('crys.working') : t('crys.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
