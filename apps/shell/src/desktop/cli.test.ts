import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@sairios/context-schema';
import { runCommand, shortId, tokenize, type CliDeps } from './cli.js';

/**
 * The `contexto` command line.
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
    locale: 'es',
    listContexts: async () => CONTEXTS,
    createContext: async (name) => ctx('dddddd', name),
    crystallize: async () => ctx('eeeeee', 'plantilla'),
    setStatus: async (id) => CONTEXTS.find((c) => c.id === id) ?? CONTEXTS[0]!,
    openContext: vi.fn(),
    openMap: vi.fn(),
    providerName: 'mock',
    serviceHealth: () => [{ label: 'contextos', ok: true }],
    ...over,
  };
}

describe('tokenizing', () => {
  it('splits on whitespace', () => {
    expect(tokenize('contexto listar')).toEqual(['contexto', 'listar']);
  });

  it('keeps a quoted name together, so names with spaces are addressable', () => {
    expect(tokenize('contexto abrir "columna de radio"')).toEqual([
      'contexto',
      'abrir',
      'columna de radio',
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('listing', () => {
  it('prints one row per context plus a header and a total', async () => {
    const result = await runCommand('contexto listar', deps());
    expect(result.lines.length).toBe(CONTEXTS.length + 3);
    expect(result.lines[0]?.text).toContain('NOMBRE');
    expect(result.lines.at(-1)?.text).toBe('3 contextos');
  });

  it('never lets a column run into the next one', async () => {
    // A name exactly as wide as its column is the case that collides.
    const wide = [ctx('ffffff', 'x'.repeat(64))];
    const result = await runCommand('contexto listar', deps({ listContexts: async () => wide }));
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
    await runCommand(`contexto abrir ${shortId(CONTEXTS[0]!)}`, deps({ openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[0]!.id);
  });

  it('accepts a unique name fragment', async () => {
    const open = vi.fn();
    await runCommand('contexto abrir mucho', deps({ openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[2]!.id);
  });

  it('refuses an ambiguous fragment rather than guessing', async () => {
    const open = vi.fn();
    // "co" matches "columna de radio" and "comparar presupuestos".
    const result = await runCommand('contexto abrir co', deps({ openContext: open }));
    expect(open).not.toHaveBeenCalled();
    expect(result.lines[0]?.tone).toBe('error');
    expect(result.lines[0]?.text).toContain('más de un contexto');
  });

  it('reports a miss plainly', async () => {
    const result = await runCommand('contexto abrir zzzzz', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });

  it('requires a target for verbs that need one', async () => {
    const result = await runCommand('contexto cristalizar', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('creating', () => {
  it('defaults to ephemeral', async () => {
    const create = vi.fn(async (name: string) => ctx('dddddd', name));
    await runCommand('contexto crear "algo nuevo"', deps({ createContext: create }));
    expect(create).toHaveBeenCalledWith('algo nuevo', 'ephemeral', 'algo nuevo');
  });

  it('honours --persistente', async () => {
    const create = vi.fn(async (name: string) => ctx('dddddd', name));
    await runCommand('contexto crear cosa --persistente', deps({ createContext: create }));
    expect(create).toHaveBeenCalledWith('cosa', 'persistent', 'cosa');
  });

  it('refuses without a name', async () => {
    const result = await runCommand('contexto crear', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('what it deliberately cannot do', () => {
  it('has no shell', async () => {
    for (const command of ['sh', 'bash -c ls', 'sudo reboot', 'exec /bin/sh', 'ssh somewhere']) {
      const result = await runCommand(command, deps());
      expect(result.lines[0]?.tone, command).toBe('error');
      expect(result.lines[0]?.text, command).toContain('no hay shell');
    }
  });

  it('rejects an unknown verb rather than guessing at a near match', async () => {
    const result = await runCommand('contexto borrar todo', deps());
    expect(result.lines[0]?.tone).toBe('error');
  });
});

describe('both languages', () => {
  it('accepts English verbs', async () => {
    const open = vi.fn();
    await runCommand('context open mucho', deps({ locale: 'en', openContext: open }));
    expect(open).toHaveBeenCalledWith(CONTEXTS[2]!.id);
  });

  it('answers in the language the desktop is set to', async () => {
    const en = await runCommand('contexto listar', deps({ locale: 'en' }));
    expect(en.lines.at(-1)?.text).toBe('3 contexts');
  });
});

describe('housekeeping', () => {
  it('clear empties the screen', async () => {
    expect((await runCommand('limpiar', deps())).clear).toBe(true);
  });

  it('help lists the commands', async () => {
    const result = await runCommand('ayuda', deps());
    expect(result.lines.length).toBeGreaterThan(5);
  });
});
