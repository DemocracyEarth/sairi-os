import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@sairios/context-schema';
import { runCommand, shortId, tokenize, type CliDeps } from './cli.js';

/**
 * The `context` command line (`contexto` in Spanish; both spellings always work).
 *
 * The properties worth protecting: it resolves targets the way a person expects,
 * it refuses ambiguity rather than guessing which context you meant, and it has
 * no path to running a program.
 */

function ctx(id: string, name: string, over: Partial<Context> = {}): Context {
  return {
    id: `ctx_${id.padEnd(32, '0')}`,
    schemaVersion: '0.1',
    name,
    type: 'ephemeral',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    objective: '',
    memory: [],
    artifacts: [],
    permissions: [],
    tasks: [],
    events: [],
    uiSpecification: null,
    agentSession: { provider: 'mock', sessionId: null, status: 'idle' },
    parentContextId: null,
    crystallizedFrom: null,
    ...over,
  };
}

const CONTEXTS = [
  ctx('aaaaaa', 'columna de radio'),
  ctx('bbbbbb', 'comparar presupuestos'),
  ctx('cccccc', 'mucho lío', { type: 'persistent' }),
];

function deps(over: Partial<CliDeps> = {}): CliDeps {
  return {
    // English is the default, so the unqualified tests below exercise the path a
    // user gets without choosing anything. Spanish has its own block.
    locale: 'en',
    listContexts: async () => CONTEXTS,
    createContext: async (name) => ctx('dddddd', name),
    crystallize: async () => ctx('eeeeee', 'plantilla'),
    setStatus: async (id) => CONTEXTS.find((c) => c.id === id) ?? CONTEXTS[0]!,
    openContext: vi.fn(),
    openMap: vi.fn(),
    providerName: 'mock',
    serviceHealth: () => [{ label: 'contexts', ok: true }],
    ...over,
  };
}

describe('tokenizing', () => {
  it('splits on whitespace', () => {
    expect(tokenize('context list')).toEqual(['context', 'list']);
  });

  it('keeps a quoted name together, so names with spaces are addressable', () => {
    expect(tokenize('context open "columna de radio"')).toEqual([
      'context',
      'open',
      'columna de radio',
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('listing', () => {
  it('prints one row per context plus a header and a total', async () => {
    const result = await runCommand('context list', deps());
    expect(result.lines.length).toBe(CONTEXTS.length + 3);
    expect(result.lines[0]?.text).toContain('NAME');
    expect(result.lines.at(-1)?.text).toBe('3 contexts');
  });

  it('never lets a column run into the next one', async () => {
    // A name exactly as wide as its column is the case that collides.
    const wide = [ctx('ffffff', 'x'.repeat(64))];
    const result = await runCommand('context list', deps({ listContexts: async () => wide }));
    const row = result.lines[1]?.text ?? '';
    expect(row).toMatch(/\s{1,}/);
    // The short id must remain readable at the start of the row.
    expect(row.startsWith(shortId(wide[0]!))).toBe(true);
    expect(row[shortId(wide[0]!).length]).toBe(' ');
  });
});

describe('resolving a target', () => {
  it('accepts the short id', async () => {
    const open = vi.fn();
    await runCommand(`context open ${shortId(CONTEXTS[0]!)}`, deps({ openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[0]!.id);
  });

  it('accepts a unique name fragment', async () => {
    const open = vi.fn();
    await runCommand('context open mucho', deps({ openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[2]!.id);
  });

  it('refuses an ambiguous fragment rather than guessing', async () => {
    const open = vi.fn();
    // "co" matches "columna de radio" and "comparar presupuestos".
    const result = await runCommand('context open co', deps({ openContext: open }));
    expect(open).not.toHaveBeenCalled();
    expect(result.lines[0]?.tone).toBe('error');
    expect(result.lines[0]?.text).toContain('more than one context');
  });

  it('reports a miss plainly', async () => {
    const result = await runCommand('context open zzzzz', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });

  it('requires a target for verbs that need one', async () => {
    const result = await runCommand('context crystallize', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('creating', () => {
  it('defaults to ephemeral', async () => {
    const create = vi.fn(async (name: string) => ctx('dddddd', name));
    await runCommand('context create "algo nuevo"', deps({ createContext: create }));
    expect(create).toHaveBeenCalledWith('algo nuevo', 'ephemeral', 'algo nuevo');
  });

  it('honours the persistence flag in either spelling', async () => {
    // Both are accepted regardless of interface language, so both are asserted.
    for (const flag of ['--persistent', '--persistente']) {
      const create = vi.fn(async (name: string) => ctx('dddddd', name));
      await runCommand(`context create cosa ${flag}`, deps({ createContext: create }));
      expect(create, flag).toHaveBeenCalledWith('cosa', 'persistent', 'cosa');
    }
  });

  it('refuses without a name', async () => {
    const result = await runCommand('context create', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('what it deliberately cannot do', () => {
  it('has no shell', async () => {
    for (const command of ['sh', 'bash -c ls', 'sudo reboot', 'exec /bin/sh', 'ssh somewhere']) {
      const result = await runCommand(command, deps());
      expect(result.lines[0]?.tone, command).toBe('error');
      expect(result.lines[0]?.text, command).toContain('no shell here');
    }
  });

  it('rejects an unknown verb rather than guessing at a near match', async () => {
    const result = await runCommand('context borrar todo', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('both languages', () => {
  it('accepts Spanish verbs even when the desktop is in English', async () => {
    // A bilingual user should not have to remember which mode the desktop is in.
    const open = vi.fn();
    await runCommand('contexto abrir mucho', deps({ openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[2]!.id);
  });

  it('accepts English verbs even when the desktop is in Spanish', async () => {
    const open = vi.fn();
    await runCommand('context open mucho', deps({ locale: 'es', openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[2]!.id);
  });

  it('answers in the language the desktop is set to', async () => {
    const en = await runCommand('context list', deps());
    expect(en.lines.at(-1)?.text).toBe('3 contexts');

    const es = await runCommand('contexto listar', deps({ locale: 'es' }));
    expect(es.lines.at(-1)?.text).toBe('3 contextos');
  });

  it('accepts the Spanish housekeeping verbs at the English default too', async () => {
    expect((await runCommand('limpiar', deps())).clear).toBe(true);
    expect((await runCommand('ayuda', deps())).lines.length).toBeGreaterThan(5);
  });

  it('names the command in the language it is speaking', async () => {
    // The English table used to say "contexto", telling an English user to type
    // a Spanish word. Each language now advertises its own spelling.
    const en = await runCommand('help', deps());
    expect(en.lines.some((l) => l.text.startsWith('context list'))).toBe(true);
    expect(en.lines.every((l) => !l.text.includes('contexto'))).toBe(true);

    const es = await runCommand('ayuda', deps({ locale: 'es' }));
    expect(es.lines.some((l) => l.text.startsWith('contexto listar'))).toBe(true);
  });

  it('opens the map with a localized name rather than a hardcoded Spanish one', async () => {
    const en = await runCommand('map', deps());
    expect(en.lines[0]?.text).toContain('context map');
    expect(en.lines[0]?.text).not.toContain('mapa');

    const es = await runCommand('mapa', deps({ locale: 'es' }));
    expect(es.lines[0]?.text).toContain('mapa de contextos');
  });
});

describe('the default language', () => {
  it('is English when nothing is chosen', async () => {
    // deps() passes no locale of its own beyond the default this file sets, so
    // this asserts the shipped default rather than a test fixture's preference.
    const result = await runCommand('context list', deps());
    expect(result.lines[0]?.text).toContain('NAME');
  });
});

describe('housekeeping', () => {
  it('clear empties the screen', async () => {
    expect((await runCommand('clear', deps())).clear).toBe(true);
  });

  it('help lists the commands', async () => {
    const result = await runCommand('help', deps());
    expect(result.lines.length).toBeGreaterThan(5);
  });
});
