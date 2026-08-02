import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { useLocale } from '@sairios/ui-components';
import { commandName, runCommand, type CliDeps, type CliLine } from './cli.js';

/**
 * The terminal window.
 *
 * A real control surface for the `context` command line (`contexto` in Spanish;
 * both spellings always work), not an ornament: it talks to the same services
 * the windows do. Command history with the arrow keys, because a terminal
 * without history is a text box.
 */

const PROMPT = 'sairi@sairios:~$';

export interface TerminalProps {
  deps: CliDeps;
}

export function Terminal({ deps }: TerminalProps): JSX.Element {
  const { locale } = useLocale();
  const [lines, setLines] = useState<CliLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Greet in whichever language the desktop is in, and say what to type.
  useEffect(() => {
    setLines([
      {
        text:
          locale === 'en'
            ? 'SairiOS — type "help" to see the available commands.'
            : 'SairiOS — escribí "ayuda" para ver las órdenes disponibles.',
        tone: 'dim',
      },
    ]);
  }, [locale]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, busy]);

  const submit = useCallback(async () => {
    const command = input;
    setInput('');
    setHistoryIndex(null);
    setLines((prev) => [...prev, { text: `${PROMPT} ${command}`, tone: 'prompt' }]);
    if (!command.trim()) return;
    setHistory((prev) => [...prev, command]);
    setBusy(true);
    try {
      const result = await runCommand(command, deps);
      setLines((prev) => (result.clear ? [] : [...prev, ...result.lines]));
    } catch (cause) {
      setLines((prev) => [
        ...prev,
        { text: cause instanceof Error ? cause.message : String(cause), tone: 'error' },
      ]);
    } finally {
      setBusy(false);
    }
  }, [deps, input]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (history.length === 0) return;
        const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        setInput(history[next] ?? '');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (historyIndex === null) return;
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(null);
          setInput('');
        } else {
          setHistoryIndex(next);
          setInput(history[next] ?? '');
        }
      }
    },
    [history, historyIndex, submit],
  );

  return (
    <div className="term" onClick={() => inputRef.current?.focus()}>
      {lines.map((line, i) => (
        <div
          className={`term__line${line.tone && line.tone !== 'prompt' ? ` term__line--${line.tone}` : ''}`}
          key={i}
        >
          {line.tone === 'prompt' ? (
            <>
              <span className="term__prompt">{PROMPT}</span>
              {line.text.slice(PROMPT.length)}
            </>
          ) : (
            line.text || ' '
          )}
        </div>
      ))}

      <div className="term__inputrow">
        <span className="term__prompt">{PROMPT}</span>
        <input
          aria-label={commandName(locale)}
          autoComplete="off"
          autoCorrect="off"
          className="term__input"
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          ref={inputRef}
          spellCheck={false}
          value={input}
        />
      </div>
      <div ref={endRef} />
    </div>
  );
}
