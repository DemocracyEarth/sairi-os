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
import { SairiUIRenderer, useTheme, type SairiUIHost } from '@sairios/ui-components';
import { AmbientBackground } from './AmbientBackground.js';
import { CommandList } from './CommandList.js';
import { Glyph } from './Glyph.js';
import { SetupWizard } from './SetupWizard.js';
import { ConvergenceMeter, ContextSurface, RunPresence, StatusOrb } from './primitives.js';
import { buildCommands, matchCommands, shouldAutoSelect } from './palette.js';
import { Talk, TalkButton } from './Talk.js';
import { useDictation } from './useDictation.js';
import { useSairi } from './useSairi.js';
import { certaintyOf, convergence, minutesSince, STATUS_LABEL, TYPE_LABEL } from './state.js';
import { bridgeApi, type SetupStatusRecord } from '../api.js';
import './tokens.css';
import './sairi.css';

/**
 * Sairi OS.
 *
 * Three layers, and deliberately not three permanent columns:
 *
 *   navigation    active and recent contexts. Closer to memory than a sidebar —
 *                 items carry heat (recency), so the rail says where work has
 *                 been happening without being read.
 *   context       the adaptive workspace. This is a SairiUI document an agent
 *                 produced, validated against the sixteen-component catalog
 *                 before a single node renders.
 *   intelligence  the live run, and the permissions it is waiting on.
 *
 * ---------------------------------------------------------------------------
 * All of this used to be a fixture
 * ---------------------------------------------------------------------------
 * Four contexts, twenty agents, sixteen bespoke lenses — a knowledge graph, a
 * map, a spatial canvas. It looked like an operating system and it was a
 * drawing of one.
 *
 * The surface now talks to the context service and the agent bridge, and the
 * workspace renders whatever the agent actually emitted. In mock mode that
 * agent is deterministic and offline, and the loop is still entirely real: a
 * real context is created and persisted, a real run streams, a real document is
 * validated, real permission requests reach the broker and wait for a real
 * decision. Configuring a provider swaps the brain; it does not switch on the
 * machinery.
 */

/**
 * How long ⌘K must be held before it becomes a microphone rather than a focus
 * shortcut. Long enough that a normal tap never opens a microphone by accident,
 * short enough that holding does not feel broken.
 */
const HOLD_MS = 350;

const EXAMPLES = [
  'Compare three vendor proposals',
  'Work out why the February cohort churned',
  'Draft the launch note for next week',
];

export function SairiOS(): JSX.Element {
  const sairi = useSairi();
  const { active, run } = sairi;

  const [intent, setIntent] = useState('');
  const [intelOpen, setIntelOpen] = useState(false);
  const [setup, setSetup] = useState<SetupStatusRecord | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  /**
   * Appearance comes from the shared hook, not a private copy.
   *
   * This surface used to hold its own `'light' | 'dark' | undefined` state and
   * read `matchMedia` directly, which broke in a way nobody could see: the
   * attribute landed on THIS div, while the SairiUI components rendered inside
   * it read `--sairi-*` tokens whose dark palette is scoped to
   * `:root[data-theme='dark']`. So dark chrome wrapped light panels — white
   * cards on a near-black field — and only for a viewer whose system was dark.
   *
   * `useTheme` writes the resolved theme onto `<html>`, which both palettes can
   * see. It also persists the choice and keeps "auto" live, neither of which the
   * private copy did.
   */
  const { resolved: theme, setPreference } = useTheme();
  /* -1 is the resting state: a command is visible but not under the Enter key
     until the user arrows to it. See shouldAutoSelect. */
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Dictation writes into the same field typing does, and never submits. */
  const talk = useDictation({
    contextId: active?.id ?? '',
    onTranscript: (text) => {
      setIntent((current) => (current ? `${current} ${text}` : text));
      inputRef.current?.focus();
    },
  });

  /* Tap ⌘K to focus the intent field; HOLD ⌘K to talk into it. */
  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    let holdTimer = 0;
    let holding = false;

    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (e.repeat || holding) return;
      holding = true;
      inputRef.current?.focus();
      inputRef.current?.select();
      holdTimer = window.setTimeout(() => talkRef.current.begin(), HOLD_MS);
    };
    const release = (): void => {
      if (!holding) return;
      holding = false;
      window.clearTimeout(holdTimer);
      talkRef.current.end();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'k' || e.key === 'Meta' || e.key === 'Control') release();
    };
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') talkRef.current.cancel();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    // A bridge that does not manage credentials answers 501; setup stays null
    // and the wizard never appears.
    void bridgeApi.setupStatus().then((r) => {
      if (!r.ok) return;
      setSetup(r.value);
      if (!r.value.configured) setWizardOpen(true);
    });
  }, []);

  const { contexts, activeId, select } = sairi;
  const commands = useMemo(
    () =>
      buildCommands({
        contexts: contexts.map((c) => ({ id: c.id, intention: c.name, kind: c.type })),
        activeId,
        onSwitch: select,
        onOpenSetup: () => setWizardOpen(true),
        /* Toggling turns "auto" into a decision, which is the point: someone who
           reaches for this wants a specific appearance, not a rule. */
        onToggleTheme: () => setPreference(theme === 'dark' ? 'light' : 'dark'),
        theme,
      }),
    [contexts, activeId, select, theme, setPreference],
  );

  const matches = useMemo(() => matchCommands(intent, commands), [intent, commands]);

  useEffect(() => {
    setSelected(shouldAutoSelect(intent, matches) ? 0 : -1);
  }, [intent, matches]);

  const runCommand = useCallback(
    (index: number) => {
      const match = matches[index];
      if (!match) return;
      setIntent('');
      setSelected(-1);
      match.command.run();
    },
    [matches],
  );

  const { begin, decide } = sairi;
  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      if (selected >= 0) {
        runCommand(selected);
        return;
      }
      const text = intent.trim();
      if (!text) return;
      setIntent('');
      inputRef.current?.blur();
      void begin(text);
    },
    [intent, selected, runCommand, begin],
  );

  /**
   * The host the catalog renders against.
   *
   * Permissions come from the BROKER rather than from the document, which is
   * what stops a fabricated `permission-request` from rendering as an
   * approvable prompt: a request id the broker does not recognise has no entry
   * here, and the component renders an error instead of a button.
   */
  const permissionRecords = sairi.permissions;
  const host: SairiUIHost = useMemo(
    () => ({
      context: active ?? null,
      permissions: Object.fromEntries(
        Object.values(permissionRecords).map((r) => [
          r.id,
          {
            requestId: r.id,
            capability: r.capability,
            reason: r.reason,
            risk: r.risk,
            status: r.status,
          },
        ]),
      ),
      onPermissionDecision: (requestId, decision, options) =>
        void decide(requestId, decision, options),
      busy: run.status !== 'idle',
    }),
    [active, permissionRecords, decide, run.status],
  );

  const pending = Object.values(permissionRecords).filter((r) => r.status === 'pending').length;

  return (
    // No `data-theme` on this div. `useTheme` puts it on <html>, where the
    // shell's tokens and the renderer's `--sairi-*` tokens can both see it;
    // scoping it here is precisely the bug described above.
    <div className="sairi s-os">
      <AmbientBackground />

      {/* ---------------------------------------------------------------- *
       * Navigation
       * ---------------------------------------------------------------- */}
      <nav aria-label="Contexts" className="s-nav">
        <div className="s-nav__brand">
          <span className="s-nav__mark" aria-hidden="true" />
          <span className="s-nav__name">Sairi</span>
        </div>

        <ul className="s-nav__list">
          {contexts.map((c) => (
            <li key={c.id}>
              <button
                aria-current={c.id === activeId ? 'true' : undefined}
                className={`s-nav__item${c.id === activeId ? ' is-active' : ''}`}
                onClick={() => select(c.id)}
                style={
                  { '--heat': Math.max(0.25, 1 - minutesSince(c.updatedAt) / 240) } as CSSProperties
                }
                type="button"
              >
                <span className="s-nav__spine" aria-hidden="true" />
                <span className="s-nav__text">
                  <span className="s-nav__kind">{TYPE_LABEL[c.type]}</span>
                  <span className="s-nav__title">{c.name}</span>
                </span>
                <span className="s-nav__signal">
                  {c.status === 'waiting' && <StatusOrb pulse size={6} label="Waiting on you" />}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="s-nav__hint">
          <kbd>
            <Glyph name="command" size={11} />K
          </kbd>{' '}
          to start anything, or type a command
        </p>
      </nav>

      {/* ---------------------------------------------------------------- *
       * The workspace — a validated SairiUI document, and nothing else
       * ---------------------------------------------------------------- */}
      <main className="s-work" key={active?.id ?? 'none'}>
        {sairi.offline ? (
          <div className="s-blank">
            <Glyph name="empty" size={22} />
            <h1>SairiOS cannot reach its services</h1>
            <p>{sairi.offline}</p>
            {/* Nothing is cached and nothing is invented. An operating system
                that shows plausible contents while disconnected is lying. */}
            <p className="s-blank__aside">
              The shell is running; the context service, agent bridge and permission broker are not
              answering. This screen is empty because there is genuinely nothing to show.
            </p>
          </div>
        ) : !active ? (
          <div className="s-blank">
            <Glyph name="empty" size={22} />
            <h1>{sairi.loading ? 'Reading your contexts…' : 'Nothing here yet'}</h1>
            {!sairi.loading && (
              <p>
                Say what you want to accomplish. Sairi creates a context for it, and an agent builds
                the interface the work needs.
              </p>
            )}
          </div>
        ) : (
          <>
            <header className="s-work__head">
              <div className="s-work__title">
                <span className="s-work__kind">
                  {TYPE_LABEL[active.type]} · {STATUS_LABEL[active.status]}
                </span>
                <h1>{active.name}</h1>
                {active.objective && <p className="s-work__objective">{active.objective}</p>}
              </div>
              <ConvergenceMeter value={convergence(active)} />
            </header>

            {active.uiSpecification ? (
              <ContextSurface certainty={certaintyOf(active)} span={12}>
                <SairiUIRenderer document={active.uiSpecification} host={host} />
              </ContextSurface>
            ) : (
              <div className="s-blank s-blank--inline">
                <Glyph name="empty" size={18} />
                <p>
                  {run.status === 'idle'
                    ? 'No interface yet. This context has not been through an agent run.'
                    : 'The agent is building an interface for this context.'}
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {/* ---------------------------------------------------------------- *
       * Intelligence — the live run
       * ---------------------------------------------------------------- */}
      <aside
        aria-label="Sairi and the current run"
        className={`s-intel${intelOpen ? ' is-open' : ''}`}
        id="sairi-intelligence"
      >
        <button
          aria-controls="sairi-intelligence"
          aria-expanded={intelOpen}
          className="s-intel__grip"
          onClick={() => setIntelOpen((v) => !v)}
          type="button"
        >
          <StatusOrb pulse={run.status !== 'idle'} size={7} />
          <span>Sairi</span>
          <span className="s-intel__count">{pending > 0 ? `${pending} waiting` : run.status}</span>
        </button>

        {setup && (
          <button className="s-intel__setup" onClick={() => setWizardOpen(true)} type="button">
            <StatusOrb size={6} />
            {setup.configured ? `${setup.provider} · ${setup.model}` : 'No model connected'}
          </button>
        )}

        <div className="s-intel__body">
          <h2 className="s-intel__heading">Run</h2>
          <RunPresence run={run} />
        </div>
      </aside>

      {/* ---------------------------------------------------------------- *
       * The universal intent field, which is also the palette
       * ---------------------------------------------------------------- */}
      <form className="s-command" onSubmit={submit} role="search">
        <Talk talk={talk} />
        <CommandList
          listId="sairi-palette"
          matches={matches}
          onHover={setSelected}
          onRun={runCommand}
          selected={selected}
        />
        <div className="s-command__field">
          <StatusOrb pulse={run.status !== 'idle'} size={7} />
          <input
            aria-activedescendant={selected >= 0 ? `sairi-palette-${selected}` : undefined}
            aria-autocomplete="list"
            aria-controls="sairi-palette"
            aria-expanded={matches.length > 0}
            aria-label="What do you want to accomplish, or a command"
            className="s-command__input"
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => {
              if (matches.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((i) => (i + 1) % matches.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((i) => (i <= 0 ? matches.length - 1 : i - 1));
              } else if (e.key === 'Escape' && selected >= 0) {
                e.preventDefault();
                setSelected(-1);
              }
            }}
            placeholder="What do you want to accomplish?"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={intent}
          />
          <TalkButton talk={talk} />
          <button className="s-command__go" disabled={!intent.trim()} type="submit">
            Begin
          </button>
        </div>

        {/* Suggestions only while there is nothing else to look at. A standing
            row of examples under a working machine is clutter. */}
        {contexts.length === 0 && !sairi.loading && (
          <ul className="s-command__examples">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <button className="s-chip" onClick={() => setIntent(e)} type="button">
                  {e}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {setup && wizardOpen && (
        <SetupWizard
          onDismiss={() => setWizardOpen(false)}
          onDone={(next) => {
            setSetup(next);
            setWizardOpen(false);
          }}
          status={setup}
        />
      )}
    </div>
  );
}
