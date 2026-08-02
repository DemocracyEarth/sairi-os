import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs generator with no type declarations, by design.
import { generate, SOURCE, TARGET } from './build-palette.mjs';

/**
 * One palette, not two.
 *
 * There used to be two token files that shared eighteen names and disagreed on
 * all eighteen values. Nothing imported the second one, so nothing caught it —
 * a greeter styled from it simply would not have matched the desktop.
 *
 * tokens.css is now canonical and palette.css is generated. These tests are what
 * keeps that true: the first fails the moment someone hand-edits the generated
 * file or changes a token without regenerating, and the rest assert the
 * properties that made the split worth keeping at all.
 */

describe('the generated palette', () => {
  it('is up to date with the tokens it derives from', async () => {
    // The whole point. If this fails: npm run build:palette
    const [generated, committed] = await Promise.all([
      generate() as Promise<string>,
      readFile(TARGET as string, 'utf8'),
    ]);
    expect(committed).toBe(generated);
  });

  it('agrees with the source on every value, which is the bug it exists to prevent', async () => {
    const values = (css: string, scope: RegExp) => {
      const body = scope.exec(css)?.[1] ?? '';
      const out = new Map<string, string>();
      for (const m of body.matchAll(/(--sairi-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
        out.set(m[1]!, m[2]!.trim().replace(/\s+/g, ' '));
      }
      return out;
    };

    const [source, palette] = await Promise.all([
      readFile(SOURCE as string, 'utf8'),
      readFile(TARGET as string, 'utf8'),
    ]);

    const light = /:root \{([\s\S]*?)\n\}/;
    const fromSource = values(source, light);
    const fromPalette = values(palette, light);

    expect(fromSource.size).toBeGreaterThan(20);
    for (const [token, value] of fromSource) {
      expect(fromPalette.get(token), `${token} differs between the two files`).toBe(value);
    }
  });

  it('carries no token the source does not define', async () => {
    // The old file had 65 of these — a parallel vocabulary (--sairi-ink,
    // --sairi-space-md) that appeared nowhere but its own README examples.
    const [source, palette] = await Promise.all([
      readFile(SOURCE as string, 'utf8'),
      readFile(TARGET as string, 'utf8'),
    ]);
    const names = (css: string) =>
      new Set([...css.matchAll(/(--sairi-[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!));

    const extra = [...names(palette)].filter((t) => !names(source).has(t));
    expect(extra, `palette.css invents: ${extra.join(', ')}`).toEqual([]);
  });
});

describe('what the second file is actually for', () => {
  it('adds the system-preference query the source deliberately omits', async () => {
    const [source, palette] = await Promise.all([
      readFile(SOURCE as string, 'utf8'),
      readFile(TARGET as string, 'utf8'),
    ]);
    // tokens.css has no such RULE on purpose: the shell resolves "match system"
    // in JS and writes a concrete data-theme. Session chrome has no JS to do
    // that. Matching on the at-rule rather than the bare string, because the
    // source mentions the words in the comment explaining the omission.
    expect(source).not.toMatch(/@media\s*\(prefers-color-scheme/);
    expect(palette).toContain('@media (prefers-color-scheme: dark)');
  });

  it('carries the reduced-motion reset across rather than silently dropping it', async () => {
    // Chrome that animates while ignoring this is an accessibility bug, and a
    // quiet omission is the exact failure mode this generator exists to stop.
    const [source, palette] = await Promise.all([
      readFile(SOURCE as string, 'utf8'),
      readFile(TARGET as string, 'utf8'),
    ]);
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(palette).toContain('@media (prefers-reduced-motion: reduce)');
    expect(palette).toContain('animation-iteration-count: 1 !important');
  });

  it('lets an explicit light choice survive a dark system setting', async () => {
    // Without the :not() guard, a user who picked light on a dark-configured
    // machine gets dark chrome anyway.
    const palette = await readFile(TARGET as string, 'utf8');
    const media = /@media \(prefers-color-scheme: dark\) \{\s*([^{]+)\{/.exec(palette);
    expect(media?.[1]?.trim()).toBe(":root:not([data-theme='light'])");
  });

  it('still honours an explicit dark choice, for chrome that can set one', async () => {
    const palette = await readFile(TARGET as string, 'utf8');
    expect(palette).toContain(":root[data-theme='dark']");
  });

  it('says plainly that it is generated', async () => {
    const palette = await readFile(TARGET as string, 'utf8');
    expect(palette).toContain('GENERATED FILE');
    expect(palette).toContain('build-palette.mjs');
  });
});
