import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { useT } from '@sairios/ui-components';
import { bridgeApi, type SetupStatusRecord } from '../api.js';

/**
 * First-run provider setup.
 *
 * SairiOS ships with a mock agent so the whole system is usable, and testable,
 * with no account anywhere. This dialog is where a person decides to move past
 * that by supplying their own provider key.
 *
 * The key is handled the way a password field should be: it lives in component
 * state for the length of one submission, is cleared the moment the request
 * returns either way, and is never persisted to localStorage, never put in a
 * URL, and never read back — the status endpoint has no field that could carry
 * it. What the user sees afterwards is "connected", not their key.
 */

export interface SetupDialogProps {
  status: SetupStatusRecord;
  onDone: (status: SetupStatusRecord) => void;
  onDismiss: () => void;
}

export function SetupDialog(props: SetupDialogProps): JSX.Element {
  const t = useT();
  const providers = props.status.providers;

  const [providerId, setProviderId] = useState(props.status.provider ?? providers[0]?.id ?? '');
  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId],
  );

  const [model, setModel] = useState(props.status.model ?? provider?.models[0]?.id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching provider must not leave the previous provider's model selected;
  // the service would reject it, but the UI should never offer the mismatch.
  useEffect(() => {
    if (provider && !provider.models.some((m) => m.id === model)) {
      setModel(provider.models[0]?.id ?? '');
    }
  }, [provider, model]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!provider || busy) return;

    setBusy(true);
    setError(null);
    const result = await bridgeApi.configureProvider({ provider: provider.id, model, apiKey });
    // Clear the key on both paths. A failed attempt is exactly when a key is
    // most likely to be left sitting in a form.
    setApiKey('');
    setBusy(false);

    if (result.ok) props.onDone(result.value);
    else setError(result.message);
  }

  const canSubmit = Boolean(provider) && model !== '' && apiKey.trim() !== '' && !busy;

  return (
    <div className="overlay" role="presentation">
      <div aria-modal="true" className="dialog dialog--setup" role="dialog">
        <header className="dialog__head">
          <h2 className="dialog__title">{t('setup.title')}</h2>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="dialog__body">
            <p className="aside__muted" style={{ marginBottom: 'var(--sairi-space-4)' }}>
              {t('setup.intro')}
            </p>

            {!props.status.openclawInstalled && (
              <p className="setup__warning">{t('setup.missingOpenclaw')}</p>
            )}

            <label className="intention__label" htmlFor="setup-provider">
              {t('setup.provider')}
            </label>
            <select
              className="intention__input"
              id="setup-provider"
              onChange={(event) => setProviderId(event.target.value)}
              style={{ marginBottom: 'var(--sairi-space-4)', width: '100%' }}
              value={provider?.id ?? ''}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <label className="intention__label" htmlFor="setup-model">
              {t('setup.model')}
            </label>
            <select
              className="intention__input"
              id="setup-model"
              onChange={(event) => setModel(event.target.value)}
              style={{ marginBottom: 'var(--sairi-space-4)', width: '100%' }}
              value={model}
            >
              {(provider?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <label className="intention__label" htmlFor="setup-key">
              {t('setup.key')}
            </label>
            <input
              autoComplete="off"
              className="intention__input"
              id="setup-key"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider?.keyHint ?? ''}
              spellCheck={false}
              style={{ width: '100%' }}
              // A password field: not rendered in plain text, not offered to a
              // password manager for saving, not captured by spellcheck.
              type="password"
              value={apiKey}
            />
            {provider && (
              <p className="setup__hint">
                {t('setup.keyWhere', { url: '' })}
                <a href={provider.docsUrl} rel="noreferrer noopener" target="_blank">
                  {provider.docsUrl}
                </a>
              </p>
            )}

            <p className="setup__privacy">{t('setup.privacy')}</p>

            {error && (
              <p className="setup__error" role="alert">
                {error}
              </p>
            )}
          </div>

          <footer className="dialog__foot">
            <button className="button" onClick={props.onDismiss} type="button">
              {t('setup.later')}
            </button>
            <button className="button button--primary" disabled={!canSubmit} type="submit">
              {busy ? t('setup.working') : t('setup.submit')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
