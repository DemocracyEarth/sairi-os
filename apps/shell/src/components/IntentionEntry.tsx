import { useState, type FormEvent, type JSX } from 'react';
import type { ContextType } from '@sairios/context-schema';

/**
 * Intention entry.
 *
 * The primary way into the system: state what you want to accomplish, choose
 * whether the work is bounded or ongoing, and a context is created for it.
 * Prominent but restrained — one field, one choice, no suggestions carousel.
 */

export interface IntentionEntryProps {
  busy: boolean;
  onSubmit: (intention: string, type: Exclude<ContextType, 'crystallized'>) => void;
}

export function IntentionEntry({ busy, onSubmit }: IntentionEntryProps): JSX.Element {
  const [value, setValue] = useState('');
  const [type, setType] = useState<Exclude<ContextType, 'crystallized'>>('ephemeral');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed, type);
    setValue('');
  };

  return (
    <form className="intention" onSubmit={submit}>
      <label className="intention__label" htmlFor="intention-input">
        What do you want to accomplish?
      </label>
      <div className="intention__row">
        <input
          autoComplete="off"
          className="intention__input"
          disabled={busy}
          id="intention-input"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Compare three vendor proposals"
          value={value}
        />
        <button
          className="sairi-button sairi-button--primary"
          disabled={busy || value.trim().length === 0}
          type="submit"
        >
          {busy ? 'Working…' : 'Create context'}
        </button>
      </div>
      <fieldset className="intention__types" style={{ border: 0, margin: 0, padding: 0 }}>
        <label className="intention__type">
          <input
            checked={type === 'ephemeral'}
            name="context-type"
            onChange={() => setType('ephemeral')}
            type="radio"
            value="ephemeral"
          />
          Ephemeral — a bounded task
        </label>
        <label className="intention__type">
          <input
            checked={type === 'persistent'}
            name="context-type"
            onChange={() => setType('persistent')}
            type="radio"
            value="persistent"
          />
          Persistent — ongoing work
        </label>
      </fieldset>
      <p className="intention__hint">
        Voice input is a documented future capability. Text only in this milestone.
      </p>
    </form>
  );
}
