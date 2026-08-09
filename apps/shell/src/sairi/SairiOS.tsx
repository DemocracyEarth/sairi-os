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
import { AmbientBackground } from './AmbientBackground.js';
import { Assembly } from './Assembly.js';
import { SetupWizard } from './SetupWizard.js';
import { AgentPresence, ConvergenceMeter, ContextSurface, StatusOrb, hue } from './primitives.js';
import { ROSTER, recordFor, setNoteRetired, type Roster } from './roster.js';
import { Glyph } from './Glyph.js';
import { CommandList } from './CommandList.js';
import { buildCommands, matchCommands, shouldAutoSelect } from './palette.js';
import { Talk, TalkButton } from './Talk.js';
import { useDictation } from './useDictation.js';
import {
  brokerContextId,
  convergence,
  readIntention,
  KIND_LABEL,
  type AssemblyBeat,
  type Panel,
  type SairiContext,
} from './state.js';
import { CONTEXT_REGISTRY, LENS_REGISTRY, blankContext } from './contexts/registry.js';
import { bridgeApi, type SetupStatusRecord } from '../api.js';
import './tokens.css';
import './sairi.css';

/**
 * Sairi OS.
 *
 * Three layers, and deliberately not three permanent columns:
 *
 *   navigation    active and recent contexts. Closer to memory than a sidebar —
 *                 items carry heat (recency) and pulse (agent activity), so the
 *                 list tells you where work is happening without being read.
 *   context       the adaptive workspace. Its SHAPE is the message; see
 *                 tokens.css on convergence.
 *   intelligence  Sairi, the agents, and the proposed next action. Collapses to
 *                 an ambient bar when the work does not need it.
 *
 * On narrow screens the three do not stack — that would just be a tall desktop.
 * Navigation becomes a horizontal context switcher, intelligence becomes a
 * bottom sheet, and the workspace keeps the whole screen, because on a phone
 * the active context is the only thing that matters.
 */

/**
 * How long ⌘K must be held before it becomes a microphone rather than a focus
 * shortcut. Long enough that a normal tap never opens a microphone by accident,
 * short enough that holding does not feel broken.
 */
const HOLD_MS = 350;

const EXAMPLES = [
  'Analyse recent quantum-computing breakthroughs',
  'Checkout payments are failing for some users',
  'Plan a multi-city trip to Japan in April',
  'Launch strategy for a new product',
];

export function SairiOS(): JSX.Element {
  const [contexts, setContexts] = useState<SairiContext[]>(() => Object.values(CONTEXT_REGISTRY));
  const [activeId, setActiveId] = useState<string>(
    () => Object.values(CONTEXT_REGISTRY)[0]?.id ?? '',
  );
  const [beat, setBeat] = useState<AssemblyBeat>('idle');
  const [assembling, setAssembling] = useState<SairiContext | null>(null);
  const [intent, setIntent] = useState('');
  const [intelOpen, setIntelOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [setup, setSetup] = useState<SetupStatusRecord | null>(null);
  /* The roster is shell state rather than per-context state, which is the whole
     point of it: retiring a note here stops that note travelling into every
     context, not just this one. Nothing persists it yet — see roster.ts. */
  const [roster, setRoster] = useState<Roster>(ROSTER);
  /* Explicit appearance beats the system preference, in both directions, and
     `undefined` means "whatever the machine says" — a third state rather than a
     boolean, because "not chosen" and "chose light" are different. */
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>();
  /* -1 is the resting state: a command is visible but not under the Enter key
     until the user arrows to it. See shouldAutoSelect. */
  const [selected, setSelected] = useState(-1);
  // Starts dismissed so nothing flashes before the bridge answers. Opens itself
  // exactly once, when the status comes back unconfigured.
  const [wizardOpen, setWizardOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => assembling ?? contexts.find((c) => c.id === activeId) ?? contexts[0],
    [assembling, contexts, activeId],
  );

  /* Dictation writes into the same field typing does, and never submits. The
     transcript arrives as ordinary editable text, which turns voice's worst
     property — an unrepairable command — into a normal edit. It is also why
     nothing downstream can tell an intention was spoken: `readIntention` sees
     exactly what the keyboard produces, so voice cannot grow its own pipeline. */
  const talk = useDictation({
    contextId: brokerContextId(active?.id ?? 'sairi-os'),
    onTranscript: (text) => {
      setIntent((current) => (current ? `${current} ${text}` : text));
      inputRef.current?.focus();
    },
  });

  /* Tap ⌘K to focus the intent field; HOLD ⌘K to talk into it.
     One key, two gestures, and the hold is the permission grant: press,
     speak, release. There is no listening state the user did not physically
     hold open, which is the only version of a microphone this system can
     honestly represent in a permission model. */
  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    let holdTimer = 0;
    let holding = false;

    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      // Key repeat fires this many times a second; only the first press counts.
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
      // Releasing either half of the chord ends the utterance. Watching only
      // for 'k' strands the recogniser open when ⌘ is lifted first, and macOS
      // does not deliver keyup for letters while ⌘ is held.
      if (e.key.toLowerCase() === 'k' || e.key === 'Meta' || e.key === 'Control') release();
    };

    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') talkRef.current.cancel();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('keyup', onKeyUp);
    // A lost focus mid-utterance must not leave the microphone open.
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

  const finishAssembly = useCallback(() => {
    setBeat('ready');
    setAssembling((pending) => {
      if (!pending) return null;
      setContexts((list) => [pending, ...list.filter((c) => c.id !== pending.id)]);
      setActiveId(pending.id);
      return null;
    });
  }, []);

  const advance = useCallback(
    (next: AssemblyBeat) => {
      if (next === 'ready') finishAssembly();
      else setBeat(next);
    },
    [finishAssembly],
  );

  /* Switching contexts is a short cross-fade of the whole room, not a swap of
     panel contents — the ambient hue changes with it, which is what makes it
     read as moving somewhere rather than filtering a list. */
  const switchTo = useCallback(
    (id: string) => {
      if (id === activeId) return;
      setSwitching(true);
      setActiveId(id);
      setIntelOpen(false);
      window.setTimeout(() => setSwitching(false), 320);
    },
    [activeId],
  );

  const systemDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = theme ?? (systemDark ? 'dark' : 'light');

  const commands = useMemo(
    () =>
      buildCommands({
        contexts,
        activeId: active?.id ?? '',
        onSwitch: (id) => switchTo(id),
        onOpenSetup: () => setWizardOpen(true),
        onToggleTheme: () => setTheme(effectiveTheme === 'dark' ? 'light' : 'dark'),
        theme: effectiveTheme,
        ...(active ? { proposal: active.proposal, onProposal: () => undefined } : {}),
      }),
    [contexts, active, effectiveTheme, switchTo],
  );

  const matches = useMemo(() => matchCommands(intent, commands), [intent, commands]);

  /* Recomputed on every keystroke rather than held: whether the top row may sit
     under Enter depends on what was just typed, and a stale selection is how a
     palette runs the wrong thing. */
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

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();

      // Enter runs the highlighted command, and otherwise means what it always
      // meant. The field never changes mode; the selection decides.
      if (selected >= 0) {
        runCommand(selected);
        return;
      }

      const text = intent.trim();
      if (!text) return;

      // The intent decides the shape of the context. A real deployment reads
      // this from the model; see readIntention() for why it is keywords here.
      const kind = readIntention(text);
      const template = CONTEXT_REGISTRY[kind];
      const next: SairiContext = template
        ? { ...template, id: `ctx-${Date.now()}`, intention: text, lastActive: 0 }
        : blankContext(text, kind);

      setAssembling(next);
      setBeat('intention');
      setIntent('');
      inputRef.current?.blur();
    },
    [intent, selected, runCommand],
  );

  const pauseAgent = useCallback((contextId: string, agentId: string) => {
    setContexts((list) =>
      list.map((c) =>
        c.id !== contextId
          ? c
          : {
              ...c,
              agents: c.agents.map((a) =>
                a.id !== agentId
                  ? a
                  : { ...a, status: a.status === 'working' ? 'idle' : 'working' },
              ),
            },
      ),
    );
  }, []);

  const retireNote = useCallback((agentId: string, noteId: string, retired: boolean) => {
    setRoster((r) => setNoteRetired(r, agentId, noteId, retired));
  }, []);

  if (!active) return <main className="sairi s-empty-os">No contexts.</main>;

  const conv = convergence(active);
  const lenses = LENS_REGISTRY[active.kind] ?? {};

  return (
    <div
      className={`sairi s-os${switching ? ' is-switching' : ''}`}
      {...(theme ? { 'data-theme': theme } : {})}
      style={{ '--tone': hue(active.hue) } as CSSProperties}
    >
      <AmbientBackground />

      {/* ---------------------------------------------------------------- *
       * Navigation layer
       * ---------------------------------------------------------------- */}
      <nav aria-label="Contexts" className="s-nav">
        <div className="s-nav__brand">
          <span className="s-nav__mark" aria-hidden="true" />
          <span className="s-nav__name">Sairi</span>
        </div>

        <ul className="s-nav__list">
          {contexts.map((c) => {
            const busy = c.agents.filter((a) => a.status === 'working').length;
            const waiting = c.agents.some((a) => a.status === 'awaiting-approval');
            return (
              <li key={c.id}>
                <button
                  aria-current={c.id === activeId ? 'true' : undefined}
                  className={`s-nav__item${c.id === activeId ? ' is-active' : ''}`}
                  onClick={() => switchTo(c.id)}
                  style={
                    {
                      '--tone': hue(c.hue),
                      // Heat: recent contexts sit forward, older ones recede.
                      '--heat': Math.max(0.25, 1 - c.lastActive / 240),
                    } as CSSProperties
                  }
                  type="button"
                >
                  <span className="s-nav__spine" aria-hidden="true" />
                  <span className="s-nav__text">
                    <span className="s-nav__kind">{KIND_LABEL[c.kind]}</span>
                    <span className="s-nav__title">{c.intention}</span>
                  </span>
                  <span className="s-nav__signal">
                    {waiting && (
                      <StatusOrb hue="amber" pulse size={6} label="Awaiting your decision" />
                    )}
                    {!waiting && busy > 0 && (
                      <StatusOrb hue={c.hue} pulse size={6} label={`${busy} agents working`} />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="s-nav__hint">
          <kbd>
            <Glyph name="command" size={11} />K
          </kbd>{' '}
          to start anything, or type a command
          {talk.availability?.state === 'ready' && (
            <>
              <br />
              hold it to talk
            </>
          )}
        </p>
      </nav>

      {/* ---------------------------------------------------------------- *
       * Context layer — the adaptive workspace
       * ---------------------------------------------------------------- */}
      <main className="s-work" key={active.id}>
        <header className="s-work__head">
          <div className="s-work__title">
            <span className="s-work__kind">{KIND_LABEL[active.kind]}</span>
            <h1>{active.intention}</h1>
            <p className="s-work__objective">{active.objective}</p>
          </div>
          <ConvergenceMeter accent={active.hue} value={conv} />
        </header>

        <div className="s-work__grid">
          {active.panels.map((panel: Panel, i) => {
            const Lens = lenses[panel.lens];
            return (
              <ContextSurface
                accent={active.hue}
                author={panel.author}
                certainty={panel.certainty}
                index={i}
                key={panel.id}
                kind={panel.lens.replace('-', ' ')}
                span={panel.span}
                title={panel.title}
              >
                {Lens ? (
                  <Lens panel={panel} />
                ) : (
                  <p className="s-empty">No lens registered for “{panel.lens}”.</p>
                )}
              </ContextSurface>
            );
          })}
        </div>
      </main>

      {/* ---------------------------------------------------------------- *
       * Intelligence layer
       * ---------------------------------------------------------------- */}
      <aside
        aria-label="Sairi and agents"
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
          <StatusOrb hue={active.hue} pulse size={7} />
          <span>Sairi</span>
          <span className="s-intel__count">
            {active.agents.filter((a) => a.status === 'working').length} working
          </span>
        </button>

        {setup && (
          <button className="s-intel__setup" onClick={() => setWizardOpen(true)} type="button">
            <StatusOrb hue={setup.configured ? 'mint' : 'amber'} size={6} />
            {setup.configured ? `${setup.provider} · ${setup.model}` : 'No model connected'}
          </button>
        )}

        <div className="s-intel__body">
          <ContextSurface
            accent={active.hue}
            certainty="resolved"
            kind="proposed"
            span={12}
            title={active.proposal.title}
          >
            <p className="s-proposal__detail">{active.proposal.detail}</p>
            <div className="s-proposal__actions">
              <button className="s-btn s-btn--primary" type="button">
                {active.proposal.verb}
              </button>
              <button className="s-btn" type="button">
                Not now
              </button>
            </div>
          </ContextSurface>

          <h2 className="s-intel__heading">Agents</h2>
          <div className="s-intel__agents">
            {active.agents.map((agent) => (
              <AgentPresence
                agent={agent}
                key={agent.id}
                kind={active.kind}
                onPause={(id) => pauseAgent(active.id, id)}
                onRedirect={() => inputRef.current?.focus()}
                onRetireNote={retireNote}
                record={recordFor(agent, roster)}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- *
       * The universal intent field
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
          <StatusOrb hue={active.hue} pulse size={7} />
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
                // Up from the resting state wraps to the last row rather than
                // doing nothing, so the list is reachable in one keystroke
                // from either direction.
                setSelected((i) => (i <= 0 ? matches.length - 1 : i - 1));
              } else if (e.key === 'Escape' && selected >= 0) {
                // Give up the selection before giving up the text: Escape
                // twice clears, once un-selects.
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
        <ul className="s-command__examples">
          {EXAMPLES.map((e) => (
            <li key={e}>
              <button className="s-chip" onClick={() => setIntent(e)} type="button">
                {e}
              </button>
            </li>
          ))}
        </ul>
      </form>

      {assembling && (
        <Assembly
          beat={beat}
          context={assembling}
          onAdvance={advance}
          onSkip={finishAssembly}
          roster={roster}
        />
      )}

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
