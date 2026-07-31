import { useState, type JSX } from 'react';
import type { CrystallizationPreview } from '@sairios/context-schema';

/**
 * Crystallization preview.
 *
 * The user sees exactly what survives and exactly what is removed BEFORE the
 * template exists. A template is the artefact most likely to be shared, so the
 * moment it is created is the moment the user must be able to check it.
 */

export interface CrystallizeDialogProps {
  preview: CrystallizationPreview;
  busy: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CrystallizeDialog({
  preview,
  busy,
  onConfirm,
  onCancel,
}: CrystallizeDialogProps): JSX.Element {
  const [name, setName] = useState(preview.proposedName);

  return (
    <div className="overlay" role="presentation">
      <div aria-modal="true" className="dialog" role="dialog">
        <header className="dialog__header">
          <h2 className="dialog__title">Crystallize context</h2>
        </header>
        <div className="dialog__body">
          <p
            className="sairi-text sairi-text--muted"
            style={{ marginBottom: 'var(--sairi-space-4)' }}
          >
            A crystallized context is a reusable workflow. It keeps the shape of the work and
            deliberately leaves the contents of this run behind.
          </p>

          <label className="intention__label" htmlFor="template-name">
            Template name
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
                Retained ({preview.retained.length})
              </h3>
              <ul className="split__list">
                {preview.retained.map((item, i) => (
                  <li key={`keep-${i}`}>{item.label}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="split__title split__title--drop">
                Removed ({preview.discarded.length})
              </h3>
              {preview.discarded.length === 0 ? (
                <p className="sairi-empty">Nothing to remove.</p>
              ) : (
                <ul className="split__list">
                  {preview.discarded.map((item, i) => (
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
        <footer className="dialog__footer">
          <button className="sairi-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="sairi-button sairi-button--primary"
            disabled={busy || name.trim().length === 0}
            onClick={() => onConfirm(name.trim())}
            type="button"
          >
            {busy ? 'Crystallizing…' : 'Crystallize'}
          </button>
        </footer>
      </div>
    </div>
  );
}
