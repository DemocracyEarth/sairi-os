# ADR 0017 — Dark stays, as a peer, resolved in exactly one place

**Status:** accepted
**Date:** 2026-08-10
**Extends** [ADR 0014](0014-monochrome-editorial-language.md), which established the
light editorial language and did not mention a second theme.

## Context

The design brief for the monochrome pass says "light mode only". A dark theme
existed anyway, and nobody could say whether it still worked — which is the
actual reason this decision got made rather than a matter of taste. So the
question was posed as keep or delete, and answering it required finding out what
was there.

What was there, established rather than assumed:

**The palette was fine.** Every ink step clears WCAG AA on the primary ground —
`ink` 15.03:1, `ink-2` 8.95, `ink-3` 6.15, `ink-4` 4.62 — and the accent is
_better_ than in light (`signal-ink` 6.11 against 4.70), because Braun orange on
charcoal can be lifted without becoming unreadable. Someone did the work.

**It was reachable and deliberate.** `⌘K` then "dark" then Enter runs "Switch to
dark appearance", a command whose search keywords include `contrast` — it was
conceived as an accessibility affordance, not a second brand. Tests pin it.

**And it had never worked on the surface that matters.** The attribute was
written onto the `.sairi` div, but the SairiUI components rendered _inside_ that
div take their colours from `--sairi-*` tokens whose dark palette is scoped to
`:root[data-theme='dark']`. Nothing on the `#/os` route ever wrote `data-theme`
to the root — `useTheme` was called only in `App.tsx`, the v0 desktop branch. So
choosing dark produced dark chrome around light panels: white cards on a #17181a
field. Contrast perfect, screen wrong.

Three further findings shaped the answer:

- **The VM console can never go dark on its own.** cog / WPE WebKit reports
  `prefers-color-scheme: light` unconditionally — there is no settings bridge and
  the Wayland platform module contains no appearance handling. So the
  `@media (prefers-color-scheme: dark)` block could only ever fire for a _remote_
  browser, never on the machine SairiOS actually runs on.
- **The choice did not survive a reload.** One `useState`, no persistence. The v0
  desktop, meanwhile, persisted to `localStorage` under `sairios.theme` and
  offered a live "auto". Two mechanisms, the worse one on the newer surface.
- **The duplicate had already drifted.** Two hand-maintained copies of the dark
  palette (a media block and an attribute block) differing by one declaration.
  And `--paper-deep` existed in light only — declared, never used, and had it
  ever been used it would have rendered near-white in a near-black field.

`packages/ui-components/src/theme.ts` already documents the correct design, and
the sairi layer had reimplemented a worse version of it:

> writes a concrete `light` or `dark` onto `<html data-theme>`, so the CSS only
> ever needs two palettes and never a `prefers-color-scheme` duplicate that could
> drift from the explicit one

## Decision

**Dark stays**, and the sairi surface adopts the mechanism the repository had
already settled on rather than keeping its own.

1. `SairiOS` uses `useTheme()`. The resolved theme lands on `<html>`, where both
   token systems can see it; the choice persists; "auto" stays live.
2. The dark palette is rescoped from `.sairi[data-theme='dark']` to
   `:root[data-theme='dark'] .sairi`, which is what makes it agree with the
   renderer's palette instead of fighting it.
3. The `@media (prefers-color-scheme: dark)` block is deleted — 36 lines. The
   preference is resolved in JavaScript now, exactly as
   `packages/ui-components/src/tokens.css` does and `os/branding/palette.test.ts`
   asserts for that file.
4. `--paper-deep` is deleted rather than given a dark counterpart. An unused
   token that exists in one theme only is dead weight, and adding it would have
   been inventing a value to satisfy a test.
5. `apps/shell/src/sairi/tokens.test.ts` computes the WCAG arithmetic for **both**
   palettes and asserts the structural invariants.

**Light remains the canonical design.** That is not a compromise position: the
one machine SairiOS actually runs on reports a light preference and cannot report
anything else, so the console is light unless a human deliberately asks
otherwise. "Light mode only" holds where SairiOS lives. A remote browser set to
dark now gets a dark theme that works, which is correct behaviour for an
operating system — an OS that ignores the system appearance preference is the odd
one out, and a marketing page's constraint is not an OS's constraint.

The knob, stated plainly because it belongs to the owner: the default preference
is `auto`, from `readStored()` in `theme.ts`. Changing that fallback to `'light'`
makes light unconditional everywhere and leaves dark as opt-in only. One word, no
other consequences.

## Consequences

**Positive**

- Dark works for the first time on `#/os`. Both palettes now key off the same
  attribute on the same element.
- One theme mechanism instead of two, one dark palette instead of two.
- The choice persists, and "auto" follows the OS at sunset.
- 36 lines of duplicated palette and one dead token gone.
- Both palettes are now pinned by arithmetic. The light ramp needed two rounds of
  re-spacing after a token shipped at 2.42:1 and nothing recorded the result;
  now a regression in either theme fails the build with the ratio in the message.

**Negative — accepted**

- **A dark-mode remote viewer no longer sees the light design.** Before, they saw
  a broken dark theme; now they see a working one that is not what the brief
  describes. That is the trade, and the knob above reverses it.
- **First paint for an "auto" dark viewer is light.** The media block used to
  cover that. The usual fix is an inline script setting the attribute before
  paint, and `script-src 'self'` with no nonce forbids inline scripts — so the
  flash is the price of not maintaining a second copy of the palette. It affects
  remote dark-mode viewers only, never the console.
- **The tests encode judgement about which token is body text.** `ink-4` must
  clear AA on `--paper` but only the large-text floor on the raised and sunk
  grounds. That is a real design decision now written into a test, and someone
  who disagrees has to argue with it rather than quietly re-space the ramp.

## Verification

`tokens.test.ts` asserts the contrast of both palettes, that they declare the
same tokens, that the ramp stays monotonic, that dark is scoped from the root,
that no `prefers-color-scheme` block returns, and that the surface does not put
the attribute back on its own div. It caught the `--paper-deep` asymmetry on its
first run, which is the class of bug it exists for.

What a test cannot do is look at the screen. The commit that landed this records
the visual check actually performed, and on which surface.

## Alternatives considered

**Delete it.** Genuinely defensible: the brief says light only, the feature had
never worked on `#/os`, it did not persist, and the console cannot auto-dark. It
would have removed roughly seventy lines and a tested command. Rejected because
the fix turned out to be smaller than the deletion — one hook swap and one
selector — and because deleting a working, contrast-passing accessibility
affordance to satisfy a brand brief is the owner's call to make explicitly, not
an implementer's to make by tidying.

**Keep both mechanisms and just fix the scoping.** The minimum change. Rejected:
it leaves two copies of the palette, and one of them had already drifted. The
next drift would be as invisible as this one.

**Keep the media block for flash-free first paint, generated from one source** —
the way `os/branding/build-palette.mjs` generates `palette.css`. A real option,
and the right one if the flash ever matters. Rejected for now as a generator and
a build step to solve a problem confined to remote dark-mode viewers, on a
surface whose canonical host cannot report a dark preference at all.

**Add a hash-based inline theme script to the CSP.** Would remove the flash
without duplication, at the cost of putting `'sha256-…'` in `script-src` and a
build step to keep the hash honest. Not worth widening a `default-src 'none'`
policy for a flash.
