import { describe, expect, it, vi } from 'vitest';
import { buildCommands, matchCommands, score, shouldAutoSelect, type Command } from './palette.js';

/**
 * The palette shares a field with the primary interaction, so the property that
 * matters is not "does it find commands" — it is **does it stay out of the way
 * of an intention**.
 *
 * A scattered-character fuzzy matcher would turn "plan a trip to Japan" into a
 * highlighted row under the Enter key. Most of this file is the list of things
 * that must NOT match.
 */

const cmd = (title: string, keywords: string[] = []): Command => ({
  id: title,
  title,
  kind: 'action',
  keywords,
  run: () => {},
});

const SET: Command[] = [
  cmd('Go to Analyse recent quantum-computing breakthroughs'),
  cmd('Go to Plan a multi-city trip to Japan in April'),
  cmd('Connect a model', ['provider', 'anthropic', 'api', 'key']),
  cmd('Switch to dark appearance', ['theme', 'appearance']),
  cmd('Request the traces'),
];

describe('score', () => {
  it('ranks a title prefix above a word prefix', () => {
    const titlePrefix = score('connect', cmd('Connect a model'));
    const wordPrefix = score('model', cmd('Connect a model'));
    expect(titlePrefix!.score).toBeGreaterThan(wordPrefix!.score);
  });

  it('matches on a word boundary, never mid-word', () => {
    // "onnect" is inside "Connect" but starts no word — a palette that allowed
    // this would match almost anything typed.
    expect(score('onnect', cmd('Connect a model'))).toBeUndefined();
    expect(score('model', cmd('Connect a model'))).toBeDefined();
  });

  it('reports which characters matched, for highlighting', () => {
    const m = score('model', cmd('Connect a model'));
    expect(m!.hits).toEqual([10, 11, 12, 13, 14]);
  });

  it('finds a command through a keyword the title does not contain', () => {
    expect(score('anthropic', cmd('Connect a model', ['anthropic']))).toBeDefined();
  });

  it('prefers the shorter of two equally-good titles', () => {
    const short = score('go', cmd('Go to A'))!;
    const long = score('go', cmd('Go to A much longer context name'))!;
    expect(short.score).toBeGreaterThan(long.score);
  });
});

describe('matchCommands — what must NOT be captured', () => {
  it('never puts a command under Enter for prose', () => {
    // Every one of these is a real example from the intent field. Some surface
    // a row — typing an existing context's intention should offer to go there
    // rather than duplicate it — but none may be PRE-SELECTED, because Enter
    // has to keep meaning "state this intention".
    for (const intention of [
      'Analyse recent quantum-computing breakthroughs',
      'Checkout payments are failing for some users',
      'Plan a multi-city trip to Japan in April',
      'Launch strategy for a new product',
      'why did the february cohort churn',
      'compare three vendor proposals',
    ]) {
      const matches = matchCommands(intention, SET);
      expect(shouldAutoSelect(intention, matches), `"${intention}" must stay an intention`).toBe(
        false,
      );
    }
  });

  it('offers the existing context rather than a duplicate, without selecting it', () => {
    const q = 'Plan a multi-city trip to Japan in April';
    const matches = matchCommands(q, SET);
    expect(matches[0]?.command.title).toBe('Go to Plan a multi-city trip to Japan in April');
    expect(shouldAutoSelect(q, matches)).toBe(false);
  });

  it('does put an abbreviation under Enter', () => {
    for (const q of ['connect', 'dark', 'api key']) {
      expect(shouldAutoSelect(q, matchCommands(q, SET)), q).toBe(true);
    }
  });

  it('stays silent until there is enough to go on', () => {
    // One character matches too much to be useful and puts a row under Enter
    // before the user has said anything.
    expect(matchCommands('c', SET)).toEqual([]);
    expect(matchCommands('', SET)).toEqual([]);
    expect(matchCommands('  ', SET)).toEqual([]);
  });

  it('does still find a command the user is plainly reaching for', () => {
    expect(matchCommands('connect', SET)[0]?.command.title).toBe('Connect a model');
    expect(matchCommands('dark', SET)[0]?.command.title).toBe('Switch to dark appearance');
    expect(matchCommands('api key', SET)[0]?.command.title).toBe('Connect a model');
  });

  it('caps the list rather than filling the screen', () => {
    const many = Array.from({ length: 40 }, (_, i) => cmd(`Go to context ${i}`));
    expect(matchCommands('go to', many).length).toBeLessThanOrEqual(6);
  });
});

describe('buildCommands', () => {
  const context = (id: string, intention: string) => ({ id, intention, kind: 'research' });

  const base = {
    contexts: [context('a', 'First thing'), context('b', 'Second thing')],
    activeId: 'a',
    onSwitch: vi.fn(),
    onOpenSetup: vi.fn(),
    onToggleTheme: vi.fn(),
    theme: 'light' as const,
  };

  it('does not offer to go where you already are', () => {
    const titles = buildCommands(base).map((c) => c.title);
    expect(titles).toContain('Go to Second thing');
    expect(titles).not.toContain('Go to First thing');
  });

  it('names the destination appearance, not the current one', () => {
    // "Dark appearance" reads as a label; the command has to read as an action.
    expect(buildCommands({ ...base, theme: 'light' }).map((c) => c.title)).toContain(
      'Switch to dark appearance',
    );
    expect(buildCommands({ ...base, theme: 'dark' }).map((c) => c.title)).toContain(
      'Switch to light appearance',
    );
  });

  it('surfaces the standing proposal as a command when there is one', () => {
    const onProposal = vi.fn();
    const commands = buildCommands({
      ...base,
      proposal: { title: 'Settle the topological claim', verb: 'Request the traces' },
      onProposal,
    });
    const found = commands.find((c) => c.title === 'Request the traces');
    expect(found).toBeDefined();
    found!.run();
    expect(onProposal).toHaveBeenCalledOnce();
  });

  it('runs the switch it advertises', () => {
    const onSwitch = vi.fn();
    buildCommands({ ...base, onSwitch })
      .find((c) => c.title === 'Go to Second thing')!
      .run();
    expect(onSwitch).toHaveBeenCalledWith('b');
  });
});
