import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two palettes, and the arithmetic nobody was checking.
 *
 * This file exists because of how the dark theme drifted out of canon: not by
 * breaking, but by nobody being able to say whether it worked. A palette is the
 * one kind of code where wrong looks like a decision. There is no exception to
 * catch, no type to fail, and a viewer only sees the damage if their machine
 * happens to be set the way the broken branch requires.
 *
 * Two classes of assertion, both about failures that are invisible:
 *
 *   1. CONTRAST. Every ink step is checked against every ground it can sit on.
 *      The light ramp needed two rounds of re-spacing after a token shipped at
 *      2.42:1, and nothing pinned the result — so the same mistake was free to
 *      happen again, in either theme.
 *
 *   2. REACH. The dark palette must be scoped from the ROOT. When it was scoped
 *      to `.sairi[data-theme='dark']`, the attribute sat on the surface div, the
 *      renderer's `:root[data-theme='dark']` palette never matched, and dark
 *      chrome wrapped light panels. Contrast was perfect and the screen was
 *      wrong.
 *
 * Values are parsed out of the stylesheet rather than copied here. A test that
 * restates the palette proves only that someone typed it twice.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
const surface = readFileSync(join(here, 'SairiOS.tsx'), 'utf8');

/**
 * The same file with its comments removed.
 *
 * Needed because the comments in both files NAME the constructs the assertions
 * below forbid — they explain the bug being prevented. Matching the raw text
 * reads the explanation as the violation, which is a false positive that costs
 * an afternoon to understand.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const tokensCode = code(tokens);
const surfaceCode = code(surface);

const LIGHT_SELECTOR = '\n.sairi {';
const DARK_SELECTOR = "\n:root[data-theme='dark'] .sairi {";

/** The declarations of one rule, by its opening selector. */
function block(selector: string): string {
  const start = tokens.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css has no rule opening with ${selector.trim()}`);
  const from = start + selector.length;
  let depth = 1;
  let i = from;
  while (depth > 0 && i < tokens.length) {
    if (tokens[i] === '{') depth += 1;
    else if (tokens[i] === '}') depth -= 1;
    i += 1;
  }
  return tokens.slice(from, i - 1);
}

/** Solid colours only. The rules and washes are alpha over an unknown ground. */
function palette(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, hex] of block(selector).matchAll(
    /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    out[name] = hex.toLowerCase();
  }
  return out;
}

const LIGHT = palette(LIGHT_SELECTOR);
const DARK = palette(DARK_SELECTOR);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return (
    0.2126 * channel(r as number) + 0.7152 * channel(g as number) + 0.0722 * channel(b as number)
  );
}

/** WCAG 2.1 relative contrast. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = ['paper', 'paper-raised', 'paper-sunk'] as const;

/**
 * What each ink step is FOR, which is what decides its threshold.
 *
 * `--paper` is the primary ground, so anything used as text has to clear AA
 * there. On the raised and sunk grounds the faintest step is allowed to fall to
 * the large-text floor — it labels and annotates at display sizes rather than
 * setting body copy. `--signal` is exempt from the text floor entirely: it is a
 * mark, and `--signal-ink` exists precisely because the mark colour is too light
 * to read as words.
 */
const AA_BODY = 4.5;
const AA_LARGE = 3;

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the %s palette', (name, P) => {
  it('parses as a full palette rather than a few stray declarations', () => {
    // Guards the parser itself: a selector rename would otherwise produce an
    // empty palette and a suite that passes by testing nothing.
    for (const token of [...GROUNDS, 'ink', 'ink-2', 'ink-3', 'ink-4', 'signal', 'signal-ink']) {
      expect(P[token], `${name} is missing --${token}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('clears AA for body text on the primary ground', () => {
    for (const ink of ['ink', 'ink-2', 'ink-3', 'ink-4', 'signal-ink'] as const) {
      const ratio = contrast(P[ink] as string, P['paper'] as string);
      expect(ratio, `${name}: --${ink} on --paper is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_BODY,
      );
    }
  });

  it('clears AA for the three strong ink steps on every ground', () => {
    for (const ink of ['ink', 'ink-2', 'ink-3'] as const) {
      for (const ground of GROUNDS) {
        const ratio = contrast(P[ink] as string, P[ground] as string);
        expect(
          ratio,
          `${name}: --${ink} on --${ground} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_BODY);
      }
    }
  });

  it('keeps the faintest step and the accent above the large-text floor everywhere', () => {
    for (const ink of ['ink-4', 'signal-ink', 'signal'] as const) {
      for (const ground of GROUNDS) {
        const ratio = contrast(P[ink] as string, P[ground] as string);
        expect(
          ratio,
          `${name}: --${ink} on --${ground} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
  });

  it('keeps the ink ramp monotonic, so the steps stay distinguishable', () => {
    // Four steps only work if each is decisively fainter than the last. A ramp
    // that inverts mid-way reads as an arbitrary set of greys.
    const ratios = (['ink', 'ink-2', 'ink-3', 'ink-4'] as const).map((t) =>
      contrast(P[t] as string, P['paper'] as string),
    );
    for (let i = 1; i < ratios.length; i += 1) {
      expect(
        ratios[i - 1],
        `${name}: --ink-${i + 1} is not fainter than the step above`,
      ).toBeGreaterThan(ratios[i] as number);
    }
  });
});

describe('the two palettes stay peers', () => {
  it('declares the same solid tokens in both, so neither can rot alone', () => {
    // A token added to light and forgotten in dark inherits the light value and
    // renders as a bright patch in a dark field — the single most likely way
    // this decays, and invisible to anyone not using dark.
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('actually swaps ink and ground rather than dimming one of them', () => {
    // The design brief's claim: paper does not become black, the two trade
    // roles. If dark's ground were merely a darker paper, this would fail.
    expect(luminance(DARK['paper'] as string)).toBeLessThan(
      luminance(LIGHT['ink'] as string) + 0.02,
    );
    expect(luminance(DARK['ink'] as string)).toBeGreaterThan(
      luminance(LIGHT['paper'] as string) - 0.2,
    );
  });
});

describe('a filled accent control stays readable', () => {
  /**
   * `--signal` is a mark, not a ground for words. White on Braun orange is
   * 3.50:1, and the primary button's label is 12px — so `--signal-fill` and
   * `--on-signal` exist, and both must flip with the theme. Dark's fill is a
   * LIGHT orange, where white was 2.09:1 and dark ink is 8.51:1.
   */
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('%s: the label clears AA on the fill', (name, P) => {
    const ratio = contrast(P['on-signal'] as string, P['signal-fill'] as string);
    expect(
      ratio,
      `${name}: --on-signal on --signal-fill is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('never puts a hard-coded white label on the raw accent again', () => {
    // The regression, in both themes at once: `background: var(--signal)` with
    // `color: #fff` reads as brand-correct and fails AA in light and badly in
    // dark, where the accent is lighter than the ground.
    const sairiCss = code(readFileSync(join(here, 'sairi.css'), 'utf8'));
    for (const rule of sairiCss.split(/^\}/m)) {
      if (!/background:\s*var\(--signal\)\s*;/.test(rule)) continue;
      expect(rule, 'white label on the raw accent').not.toMatch(/color:\s*#fff/i);
    }
  });
});

describe('the sign-in page speaks the same language', () => {
  /**
   * The door is a string in a Node script, outside the Vite build, so its
   * colours are literals. That copy is checked here rather than trusted — it
   * had already drifted a whole palette, shipping dark navy and a violet button
   * long after the shell became monochrome, and it is the first screen a remote
   * operator sees.
   */
  const door = readFileSync(join(here, '..', '..', 'access.mjs'), 'utf8');

  it('uses the light palette values, not a set of its own', () => {
    for (const token of ['paper', 'ink', 'ink-3', 'ink-4', 'signal-fill', 'signal-ink'] as const) {
      expect(door, `the door does not use --${token} (${LIGHT[token]})`).toContain(
        LIGHT[token] as string,
      );
    }
  });

  it('uses the dark palette values for its dark counterpart', () => {
    // A media query is correct on this page: there is no JavaScript to resolve
    // a preference before paint. Same reason os/branding/palette.css keeps one.
    expect(door).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    for (const token of ['paper', 'paper-raised', 'ink', 'signal-fill', 'on-signal'] as const) {
      expect(door, `the door's dark block does not use --${token} (${DARK[token]})`).toContain(
        DARK[token] as string,
      );
    }
  });

  it('carries no trace of the palette it came from', () => {
    // Dark navy ground, violet button, salmon error text.
    for (const ghost of ['#070b1d', '#6d5efc', '#ff8a7a']) {
      expect(door, `${ghost} is from the spectral palette`).not.toContain(ghost);
    }
  });

  it('does not try to load a webfont it cannot reach', () => {
    // The vendored faces sit at content-hashed /assets paths behind this very
    // door. A @font-face here would 401, and widening PUBLIC_PATHS to serve
    // typography would trade a real boundary for a heading.
    expect(door).not.toMatch(/@font-face|\.woff2|fonts\.googleapis\.com/);
  });
});

describe('the dark palette can be reached by both token systems', () => {
  it('is scoped from the root, not from the surface element', () => {
    // The bug this replaces: with the attribute on the `.sairi` div, the
    // renderer's `--sairi-*` dark palette at `:root[data-theme='dark']` never
    // matched, so dark chrome wrapped light panels.
    expect(tokensCode).toContain(DARK_SELECTOR.trim());
    expect(tokensCode).not.toMatch(/\.sairi\[data-theme=/);
  });

  it('has no prefers-color-scheme block, because JavaScript resolves the choice', () => {
    // Same rule the ui-components token source follows, asserted the same way
    // in os/branding/palette.test.ts, and for the same reason: a second copy of
    // twenty-odd values drifts. This one had already started to.
    expect(tokensCode).not.toMatch(/@media\s*\(prefers-color-scheme/);
  });

  it('leaves appearance to the shared hook instead of a private copy', () => {
    // `useTheme` persists the choice, keeps "auto" live, and writes the resolved
    // theme onto <html>. The private state this replaced did none of the three.
    expect(surfaceCode).toMatch(/useTheme\(\)/);
    expect(surfaceCode).not.toMatch(/matchMedia\(\s*['"]\(prefers-color-scheme/);
    // Nothing may put the attribute back on the surface div.
    expect(surfaceCode).not.toMatch(/'data-theme'|"data-theme"|data-theme=/);
  });
});
