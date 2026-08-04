import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX,
} from 'react';
import { bridgeApi, type SetupProviderRecord, type SetupStatusRecord } from '../api.js';
import { StatusOrb, hue } from './primitives.js';
import type { Spectral } from './state.js';
import './wizard.css';

/**
 * First-run setup: connecting Sairi to a model.
 *
 * This is the only screen in the product that handles a secret, and the only
 * one a person meets before the system can think. Both facts shape it.
 *
 * ---------------------------------------------------------------------------
 * What it does with the key
 * ---------------------------------------------------------------------------
 * The key lives in component state for the length of one submission and is
 * cleared on both paths — success and failure. A failed attempt is exactly when
 * a key is most likely to be left sitting in a form, so it is cleared there too
 * and retyped. Nothing is written to localStorage, nothing goes in a URL, and
 * nothing reads it back: `GET /setup` has no field that could carry a key, by
 * design rather than by omission. See services/agent-bridge/src/setup.ts.
 *
 * ---------------------------------------------------------------------------
 * Why a wizard rather than a form
 * ---------------------------------------------------------------------------
 * The single dialog it replaces asked for provider, model and key at once, and
 * silently assumed OpenClaw was present. Three things go wrong there: a machine
 * with no OpenClaw gets a form it cannot complete, a person who does not have a
 * key yet has nowhere to go, and the moment the key is handed over is
 * indistinguishable from picking a dropdown.
 *
 * Steps make each of those a place. The environment is checked before anything
 * is asked for; the key step says plainly where the key goes and what SairiOS
 * will never do with it; and connecting is its own beat with a real result.
 */

type Step = 'welcome' | 'runtime' | 'provider' | 'key' | 'connecting' | 'done';

const ORDER: Step[] = ['welcome', 'runtime', 'provider', 'key', 'connecting', 'done'];

const STEP_LABEL: Record<Step, string> = {
  welcome: 'Start',
  runtime: 'Runtime',
  provider: 'Model',
  key: 'Key',
  connecting: 'Connect',
  done: 'Ready',
};

/** Colour per provider, so the choice is recognisable later in the rail. */
const PROVIDER_HUE: Record<string, Spectral> = {
  anthropic: 'coral',
  openai: 'mint',
};

export function SetupWizard({
  status,
  onDone,
  onDismiss,
}: {
  status: SetupStatusRecord;
  onDone: (next: SetupStatusRecord) => void;
  onDismiss: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const [providerId, setProviderId] = useState(status.provider ?? status.providers[0]?.id ?? '');
  const [model, setModel] = useState(status.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<SetupStatusRecord>(status);
  const keyRef = useRef<HTMLInputElement>(null);

  const provider = useMemo<SetupProviderRecord | undefined>(
    () => live.providers.find((p) => p.id === providerId) ?? live.providers[0],
    [live.providers, providerId],
  );

  const accent = PROVIDER_HUE[provider?.id ?? ''] ?? 'cyan';

  // Keep the model valid for the chosen provider. The service would reject a
  // mismatch, but the UI should never offer one in the first place.
  useEffect(() => {
    if (provider && !provider.models.some((m) => m.id === model)) {
      setModel(provider.models[0]?.id ?? '');
    }
  }, [provider, model]);

  useEffect(() => {
    if (step === 'key') keyRef.current?.focus();
  }, [step]);

  /* Re-check the runtime when that step opens rather than trusting the status
     captured at mount: someone may have installed OpenClaw in between, and
     telling them it is missing when it is not would be its own bug. */
  const recheck = useCallback(async () => {
    const result = await bridgeApi.setupStatus();
    if (result.ok) setLive(result.value);
  }, []);

  useEffect(() => {
    if (step === 'runtime') void recheck();
  }, [step, recheck]);

  const connect = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!provider || !model || !apiKey.trim()) return;

      setStep('connecting');
      setError(null);
      const result = await bridgeApi.configureProvider({
        provider: provider.id,
        model,
        apiKey,
      });
      // Cleared on both paths. A failed attempt is where a key gets left behind.
      setApiKey('');

      if (result.ok) {
        setLive(result.value);
        setStep('done');
      } else {
        setError(result.message);
        setStep('key');
      }
    },
    [provider, model, apiKey],
  );

  const index = ORDER.indexOf(step);

  return (
    <div
      className="sairi s-wiz"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Sairi to a model"
    >
      <div
        className="s-wiz__glow"
        aria-hidden="true"
        style={{ '--accent': hue(accent) } as CSSProperties}
      />

      <div className="s-wiz__panel" style={{ '--accent': hue(accent) } as CSSProperties}>
        {/* The spine: where you are, and how much is left. */}
        <ol className="s-wiz__spine" aria-label="Setup progress">
          {ORDER.filter((s) => s !== 'connecting').map((s) => {
            const at = ORDER.indexOf(s);
            const state = at < index ? 'done' : at === index ? 'now' : 'todo';
            return (
              <li className={`s-wiz__beat s-wiz__beat--${state}`} key={s}>
                <span className="s-wiz__dot" aria-hidden="true" />
                <span className="s-wiz__beatlabel">{STEP_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>

        <div className="s-wiz__stage">
          {step === 'welcome' && (
            <section className="s-wiz__step">
              <p className="s-wiz__eyebrow">Sairi OS</p>
              <h1 className="s-wiz__title">Sairi needs a model to think with.</h1>
              <p className="s-wiz__lede">
                Everything you have seen so far runs offline against a built-in mock agent — real
                contexts, real permissions, real interface, no thinking. Connecting your own
                provider account is what turns that on.
              </p>
              <ul className="s-wiz__facts">
                <li>
                  <StatusOrb hue={accent} size={6} /> You use your own account. Sairi never bills
                  you and never calls a provider itself.
                </li>
                <li>
                  <StatusOrb hue={accent} size={6} /> The key is stored in one file on this machine,
                  readable only by SairiOS.
                </li>
                <li>
                  <StatusOrb hue={accent} size={6} /> You can skip this. Everything keeps working on
                  the mock agent.
                </li>
              </ul>
              <div className="s-wiz__actions">
                <button
                  className="s-btn s-btn--primary"
                  onClick={() => setStep('runtime')}
                  type="button"
                >
                  Get started
                </button>
                <button className="s-btn" onClick={onDismiss} type="button">
                  Not now
                </button>
              </div>
            </section>
          )}

          {step === 'runtime' && (
            <section className="s-wiz__step">
              <p className="s-wiz__eyebrow">Step 1 · Runtime</p>
              <h1 className="s-wiz__title">
                {live.openclawInstalled ? 'OpenClaw is installed.' : 'OpenClaw is not installed.'}
              </h1>

              <div className={`s-wiz__check${live.openclawInstalled ? ' is-ok' : ' is-missing'}`}>
                <StatusOrb
                  hue={live.openclawInstalled ? 'mint' : 'amber'}
                  pulse={!live.openclawInstalled}
                  size={9}
                />
                <div>
                  <p className="s-wiz__checkline">
                    {live.openclawInstalled
                      ? (live.openclawVersion ?? 'installed')
                      : 'No openclaw binary found on this machine'}
                  </p>
                  <p className="s-wiz__checknote">
                    OpenClaw is the agent runtime Sairi talks to. It is a separate upstream project
                    and is reached over a local gateway at <code>{live.gatewayUrl}</code>.
                  </p>
                </div>
              </div>

              {!live.openclawInstalled && (
                <div className="s-wiz__install">
                  <p className="s-wiz__lede">Install it, then check again:</p>
                  <pre className="s-wiz__code">npm install -g openclaw</pre>
                  <p className="s-wiz__checknote">
                    Sairi will not install it for you — it is not Sairi&rsquo;s software to put on
                    your machine.
                  </p>
                </div>
              )}

              <div className="s-wiz__actions">
                <button
                  className="s-btn s-btn--primary"
                  disabled={!live.openclawInstalled}
                  onClick={() => setStep('provider')}
                  type="button"
                >
                  Continue
                </button>
                <button className="s-btn" onClick={() => void recheck()} type="button">
                  Check again
                </button>
                <button className="s-btn s-btn--quiet" onClick={onDismiss} type="button">
                  Skip
                </button>
              </div>
            </section>
          )}

          {step === 'provider' && (
            <section className="s-wiz__step">
              <p className="s-wiz__eyebrow">Step 2 · Model</p>
              <h1 className="s-wiz__title">Which model should Sairi use?</h1>

              <div className="s-wiz__providers" role="radiogroup" aria-label="Provider">
                {live.providers.map((p) => {
                  const chosen = p.id === provider?.id;
                  return (
                    <button
                      aria-checked={chosen}
                      className={`s-wiz__provider${chosen ? ' is-chosen' : ''}`}
                      key={p.id}
                      onClick={() => setProviderId(p.id)}
                      role="radio"
                      style={{ '--accent': hue(PROVIDER_HUE[p.id] ?? 'cyan') } as CSSProperties}
                      type="button"
                    >
                      <span className="s-wiz__providername">{p.label}</span>
                      <span className="s-wiz__providermeta">
                        {p.models.length} model{p.models.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {provider && (
                <div className="s-wiz__models" role="radiogroup" aria-label="Model">
                  {provider.models.map((m) => (
                    <button
                      aria-checked={m.id === model}
                      className={`s-wiz__model${m.id === model ? ' is-chosen' : ''}`}
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      role="radio"
                      type="button"
                    >
                      <span className="s-wiz__modelname">{m.label}</span>
                      <code className="s-wiz__modelid">{m.id}</code>
                    </button>
                  ))}
                </div>
              )}

              <div className="s-wiz__actions">
                <button
                  className="s-btn s-btn--primary"
                  disabled={!provider || !model}
                  onClick={() => setStep('key')}
                  type="button"
                >
                  Continue
                </button>
                <button className="s-btn" onClick={() => setStep('runtime')} type="button">
                  Back
                </button>
              </div>
            </section>
          )}

          {step === 'key' && provider && (
            <form className="s-wiz__step" onSubmit={(e) => void connect(e)}>
              <p className="s-wiz__eyebrow">Step 3 · Key</p>
              <h1 className="s-wiz__title">Paste your {provider.label} key.</h1>

              <input
                autoComplete="off"
                className="s-wiz__key"
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.keyHint}
                ref={keyRef}
                spellCheck={false}
                type="password"
                value={apiKey}
              />

              <p className="s-wiz__where">
                Don&rsquo;t have one?{' '}
                <a href={provider.docsUrl} rel="noreferrer noopener" target="_blank">
                  {provider.docsUrl}
                </a>
              </p>

              {/* The promise, stated where the key is handed over rather than in a
                  policy page nobody opens. Every line here is enforced in
                  services/agent-bridge/src/setup.ts and asserted in its tests. */}
              <ul className="s-wiz__promise">
                <li>Written to one file on this machine, readable only by SairiOS.</li>
                <li>Never shown again. No screen in Sairi can display it back.</li>
                <li>Never sent anywhere except your provider, by OpenClaw.</li>
                <li>Never logged, never put in a context, never carried into a template.</li>
              </ul>

              {error && (
                <p className="s-wiz__error" role="alert">
                  {error}
                </p>
              )}

              <div className="s-wiz__actions">
                <button className="s-btn s-btn--primary" disabled={!apiKey.trim()} type="submit">
                  Connect
                </button>
                <button className="s-btn" onClick={() => setStep('provider')} type="button">
                  Back
                </button>
              </div>
            </form>
          )}

          {step === 'connecting' && (
            <section className="s-wiz__step s-wiz__step--center">
              <div className="s-wiz__pulse" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h1 className="s-wiz__title">Connecting…</h1>
              <p className="s-wiz__lede">
                Writing the credential, onboarding OpenClaw, and bringing up the gateway.
              </p>
            </section>
          )}

          {step === 'done' && (
            <section className="s-wiz__step s-wiz__step--center">
              <StatusOrb hue="mint" pulse size={14} />
              <h1 className="s-wiz__title">Sairi is connected.</h1>
              <p className="s-wiz__lede">
                {live.provider} · {live.model}
              </p>
              <p className="s-wiz__checknote">
                Type an intention and Sairi will build a context around it. To change models later,
                open setup again from the Sairi panel.
              </p>
              <div className="s-wiz__actions">
                <button className="s-btn s-btn--primary" onClick={() => onDone(live)} type="button">
                  Start working
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
