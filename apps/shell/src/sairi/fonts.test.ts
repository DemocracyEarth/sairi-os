import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The typefaces, and the two ways this silently breaks.
 *
 * These are the first binary assets the repository tracks, and the whole reason
 * they exist is that the previous arrangement failed without any symptom: the
 * CSS named `'Inter Tight'`, no machine on either surface had it, and the page
 * rendered a fallback that looks nearly right. Nothing errored, nothing showed
 * in a diff, and the token that was supposed to request it turned out to have no
 * consumers at all.
 *
 * So the tests here assert the things whose failure is invisible:
 *
 *   1. the display token is actually CONSUMED somewhere — a token with no
 *      consumers cannot be seen, and this one sat dead through a design pass;
 *   2. the fonts are the exact bytes recorded in fonts/README.md;
 *   3. no `data:` URI and no foreign host can creep into a font source, because
 *      `font-src 'self'` permits neither and the browser's response to both is
 *      to quietly use something else.
 *
 * Source files, not `dist/`. `make validate` runs tests before the build, so a
 * test that read the bundle would pass against whatever was lying around.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

const tokens = read('tokens.css');
const sairi = read('sairi.css');
const wizard = read('wizard.css');
const viteConfig = readFileSync(join(here, '..', '..', 'vite.config.ts'), 'utf8');

/**
 * Digests of the vendored binaries, so an opaque blob is auditable by the suite
 * rather than only by a human re-reading fonts/README.md. A font that changes
 * without its README changing fails here.
 */
const FONTS = {
  'inter-latin-wght-normal.woff2': {
    sha256: '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
    bytes: 48_256,
    family: 'Inter',
    weights: '100 900',
  },
  'inter-tight-latin-wght-normal.woff2': {
    sha256: '77fefe8ca19b9f69b5284832c519e0493127c1f091f0a8936884be7721c4e618',
    bytes: 44_872,
    family: 'Inter Tight',
    weights: '100 900',
  },
  'jetbrains-mono-latin-wght-normal.woff2': {
    sha256: '18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e',
    bytes: 40_404,
    // 800, not 900 — this file's `wght` axis stops there, and a declared range
    // wider than the axis makes the browser synthesise what it could have
    // interpolated. The value is asserted so a copy-paste from the other two
    // cannot slip through.
    family: 'JetBrains Mono',
    weights: '100 800',
  },
} as const;

describe('the vendored font binaries', () => {
  for (const [file, expected] of Object.entries(FONTS)) {
    it(`${file} is the exact file recorded in fonts/README.md`, () => {
      const bytes = readFileSync(join(here, 'fonts', file));
      expect(bytes.byteLength).toBe(expected.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.sha256);
      // wOF2. A .woff2 extension over some other format is served with the
      // right content type and rejected by the font parser.
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    });
  }

  it('ships the OFL text beside every font, as clause 2 requires', () => {
    // The licence has to travel with the copy. Deleting one of these while
    // keeping its font is a licence violation, not an untidy directory.
    for (const licence of ['OFL-inter.txt', 'OFL-inter-tight.txt', 'OFL-jetbrains-mono.txt']) {
      expect(read(join('fonts', licence))).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});

describe('the @font-face declarations', () => {
  for (const [file, expected] of Object.entries(FONTS)) {
    it(`declares ${expected.family} at its real axis range`, () => {
      const block = tokens
        .split('@font-face')
        .find((chunk) => chunk.includes(`'${expected.family}'`) && chunk.includes(file));
      expect(block, `no @font-face block for ${expected.family}`).toBeDefined();
      expect(block).toContain(`font-weight: ${expected.weights}`);
      expect(block).toContain('font-display: swap');
      // Plain `woff2`. A browser that does not recognise a format string skips
      // the source, so the legacy `woff2-variations` token buys nothing and
      // risks the exact silent fallback this file guards against.
      //
      // The `src:` DECLARATION, not the block: the comment above that
      // declaration names the token it warns against, and a block-wide match
      // reads the warning as the violation.
      const src = block?.match(/^\s*src:.*$/m)?.[0];
      expect(src).toContain("format('woff2')");
      expect(src).not.toContain('woff2-variations');
    });
  }

  it('sources every font from a relative file and never a data: URI', () => {
    // `font-src 'self'` has no `data:`, unlike `img-src`. An inlined font is a
    // CSP violation whose only symptom is a fallback typeface.
    const sources = [...tokens.matchAll(/src:\s*url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
    expect(sources).toHaveLength(3);
    for (const src of sources) {
      expect(src.startsWith('./fonts/')).toBe(true);
      expect(src.endsWith('.woff2')).toBe(true);
    }
    expect(tokens).not.toMatch(/data:/);
  });

  it('never reaches a foreign font host, however convenient', () => {
    // The landing page may use Google Fonts; the shell's policy is
    // `default-src 'none'`, and widening it for typography would trade a real
    // boundary for a typeface.
    for (const css of [tokens, sairi, wizard]) {
      expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|@import\s+url\(/);
    }
  });
});

describe('the display token is actually used', () => {
  /**
   * The regression this exists to catch, because it already happened once:
   * `--font-display` was declared, never referenced, and the display headings
   * inherited the body family. Every possible way of delivering Inter Tight
   * would have rendered identically — which is to say, not at all.
   */
  it('is consumed by at least one rule outside the token layer', () => {
    const consumers = [sairi, wizard].flatMap((css) => [...css.matchAll(/var\(--font-display\)/g)]);
    expect(consumers.length).toBeGreaterThan(0);
  });

  /**
   * Dead CSS from a component deleted earlier: it sets the display size but
   * renders nowhere, so requiring the display family of it would be noise. The
   * exclusion is named rather than silent, and the test below asserts the rule
   * still exists — so whoever removes the dead CSS gets a failure telling them
   * to remove this exclusion with it, instead of leaving a carve-out for a
   * selector that no longer exists.
   */
  const DEAD_RULE = '.s-assembly__intent';

  it('has exactly one exclusion, and it is still real', () => {
    expect(sairi).toContain(DEAD_RULE);
  });

  it('is consumed by every rule that sets the display size', () => {
    // A heading at --t-display in the body family is the exact bug that hid
    // here before: right size, wrong cut, invisible unless you know.
    for (const [name, css] of [
      ['sairi.css', sairi],
      ['wizard.css', wizard],
    ] as const) {
      for (const block of css.split(/^\}/m)) {
        const setsDisplaySize =
          block.includes('var(--t-display)') || block.includes('var(--track-display)');
        if (!setsDisplaySize || block.includes(DEAD_RULE)) continue;
        expect(block, `${name}: display-sized rule without var(--font-display)`).toContain(
          'var(--font-display)',
        );
      }
    }
  });
});

describe('the bundler cannot inline a font', () => {
  it('pins assetsInlineLimit to 0', () => {
    // Vite's default is 4096 bytes. Fix the bundler, never the policy.
    expect(viteConfig).toMatch(/assetsInlineLimit:\s*0/);
  });

  it('keeps font-src at self, with no data: and no host', () => {
    // The policy ENTRY, not the file: prose about `font-src` and `data:` lives
    // in the comments here and in vite.config.ts, and a file-wide regex reads
    // the explanation as the thing it warns against.
    const entries = [...viteConfig.matchAll(/"(font-src[^"]*)"/g)].map((m) => m[1]);
    expect(entries).toEqual(["font-src 'self'"]);
  });
});
