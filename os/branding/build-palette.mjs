#!/usr/bin/env node
/**
 * Generates os/branding/palette.css from the shell's design tokens.
 *
 * Why this exists:
 *
 *   There were two token files. `packages/ui-components/src/tokens.css` is the
 *   live one — imported by styles.css, used by the shell and the component
 *   catalog, exercised by every renderer test. `os/branding/palette.css` was a
 *   hand-written reference for OS-level session chrome, installed to
 *   /usr/share/sairios/palette.css by provisioning.
 *
 *   They shared eighteen token names and disagreed on all eighteen values.
 *   `--sairi-accent` was #3a6ea5 in one and #3b6ea5 in the other; borders,
 *   status colours and the mono stack all differed. Nothing imported palette.css,
 *   so it was dead code that read as authoritative: a greeter styled from it
 *   would not have matched the desktop it was a greeter for.
 *
 *   It also carried sixty-five tokens the product does not use — a parallel
 *   vocabulary (`--sairi-ink`, `--sairi-space-md`, `--sairi-radius-md`) that
 *   appeared nowhere outside palette.css and its own README examples. Those are
 *   gone. A vocabulary nothing speaks is not a design system.
 *
 * So tokens.css is canonical and this generates the other from it. The values
 * cannot drift, because there is now only one place they are written.
 *
 * The derivation is not a copy, and the difference is the reason the second file
 * still exists at all:
 *
 *   tokens.css deliberately has NO `prefers-color-scheme` block. The shell
 *   resolves the "match system" preference in JavaScript and always writes a
 *   concrete `data-theme` onto the element, so it has one source of truth and
 *   the user can override the system.
 *
 *   Session chrome has no JavaScript. A greeter cannot resolve a preference and
 *   write an attribute, so it needs the media query. This adds one — scoped with
 *   `:not([data-theme='light'])` so an explicit attribute still wins if
 *   something does set one.
 *
 * The generated file is committed, and palette.test.ts regenerates it and fails
 * if it differs, so the two cannot come apart again. Same arrangement as the
 * precompiled SairiUI validator; see docs/adr/0009.
 *
 *   node os/branding/build-palette.mjs [--check]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = resolve(HERE, '../../packages/ui-components/src/tokens.css');
export const TARGET = resolve(HERE, 'palette.css');

const HEADER = `/*
 * SairiOS design tokens for session chrome.
 *
 * GENERATED FILE — DO NOT EDIT.
 *
 *   Source:    packages/ui-components/src/tokens.css
 *   Generator: os/branding/build-palette.mjs
 *   Regenerate: npm run build:palette
 *
 * Edit the source. A change made here is overwritten by the next build, and
 * os/branding/palette.test.ts fails until this file matches the source again.
 *
 * This exists so that OS-level chrome — a greeter, a login screen, a splash —
 * uses exactly the values the desktop uses. The one difference from the source
 * is the \`prefers-color-scheme\` block below: the shell resolves the theme in
 * JavaScript and writes \`data-theme\`, and session chrome has no JavaScript to
 * do that with.
 *
 * Installed to /usr/share/sairios/palette.css by sairios-provision.
 *
 * NOT VERIFIED: contrast ratios were chosen to clear WCAG AA (4.5:1 for body
 * text, 3:1 for large text and UI boundaries) by construction. They have not
 * been measured. Measure before shipping anything that matters.
 */
`;

/** Pulls one top-level block out of the source by its selector. */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`build-palette: no "${selector}" block in tokens.css`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i).replace(/^\n+|\s+$/g, '');
    }
  }
  throw new Error(`build-palette: unterminated "${selector}" block`);
}

/** Re-indents a block body by one extra level, for nesting inside a media query. */
function indent(body) {
  return body
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
}

/** Lifts a whole at-rule out of the source verbatim, brace-matched. */
function atRule(css, prelude) {
  const start = css.indexOf(prelude);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return null;
}

export async function generate() {
  const css = await readFile(SOURCE, 'utf8');
  const light = block(css, ':root');
  const dark = block(css, ":root[data-theme='dark']");
  // Carried across rather than dropped. Session chrome that animates while
  // ignoring this is an accessibility bug, and a silent omission here is exactly
  // the drift this generator exists to stop.
  const reducedMotion = atRule(css, '@media (prefers-reduced-motion: reduce)');

  return `${HEADER}
:root {
${light}
}

/* An explicit choice always wins. Written by the shell, or by anything else
   that can run code. */
:root[data-theme='dark'] {
${dark}
}

/*
 * The system preference, for chrome that cannot run JavaScript.
 *
 * Scoped with :not([data-theme='light']) so that an explicit light choice is not
 * overridden by a dark system setting. Without the guard, a user who picked
 * light on a dark-configured machine would get dark chrome anyway.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${indent(dark)}
  }
}
${reducedMotion ? `\n${reducedMotion}\n` : ''}`;
}

const isCheck = process.argv.includes('--check');
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const generated = await generate();
  if (isCheck) {
    const current = await readFile(TARGET, 'utf8').catch(() => '');
    if (current !== generated) {
      process.stderr.write(
        'build-palette: palette.css is out of date. Run `npm run build:palette`.\n',
      );
      process.exit(1);
    }
    process.stdout.write('build-palette: palette.css is up to date.\n');
  } else {
    await writeFile(TARGET, generated, 'utf8');
    process.stdout.write(`build-palette: wrote ${TARGET}\n`);
  }
}
