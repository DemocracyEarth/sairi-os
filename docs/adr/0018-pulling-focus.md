# ADR 0018 — Pulling focus, and a narrow exception to the blur ban

**Status:** accepted
**Date:** 2026-08-11
**Amends** [ADR 0014](0014-monochrome-editorial-language.md), which states "No blur,
no glow, no drifting fields." The ban on glow and drifting fields stands. Blur
gains exactly one exception, described below.

## Context

The brief asks for attention to land on the one thing that matters, and names the
case: clicking the intention field should give it protagonism, with the field
behind it receding. The owner's words were that everything behind it blurs.

ADR 0014 banned blur for a reason that has not stopped being true — glass made
every layer look like the same layer, so depth stopped meaning anything, and the
language moved hierarchy into ink weight, rule weight and space. `sairi.css` rule
2 says it again at the top of the file.

Two facts about the machine settle how far the request can be taken literally.

**The canonical surface cannot afford a blur.** The guest kiosk is `cog` on WPE
WebKit 2.38.6 under `weston --use-pixman` — software rasterisation, no GL — and
the session additionally exports `WEBKIT_DISABLE_COMPOSITING_MODE=1`. WebKit
implements `backdrop-filter` on the accelerated compositing path that env var
switches off.

**And it cannot be applied to the layout as it stands.** `grid-area` resolves
only for direct children of `.s-os`, so wrapping the three regions in one
blurrable container destroys the grid. Blurring them individually means three
software convolution passes of roughly a viewport each, per frame, on an ARM VM.

The frame cost was **not measured**. An attempt to benchmark it in a nested
`weston` failed because the headless backend never presents, so
`requestAnimationFrame` never fired at all. That absence is recorded here rather
than papered over: the guest is excluded by construction, not by benchmark.

## Decision

Focus is pulled by **one absolutely positioned veil** at `--z-veil: 35`, above the
three regions and below `--z-command: 40`.

**The veil is paper-coloured.** So the ground does not change at all; only the ink
recedes toward it. That makes the recession exact arithmetic rather than a
judgement, and `tokens.test.ts` pins it: at `--veil` the strongest ink still
clears 3:1, so a heading stays legible and nobody loses their place, while body
and label steps drop away. Fainter steps fall below a reading floor deliberately.

That is a real tension with `sairi.css` rule 3 — opacity never fades text — and
the resolution is threefold: the state is transient, it is user-initiated, and
everything still being read (the bar, the command list, the microphone pip) lives
at `--z-command` or above and is therefore fully lit. Rule 3 protects text the
reader still needs. This veils text the reader has just chosen to look away from.

**The z-order does the hard work.** `.s-talk` lives inside `.s-command`, so the
microphone indicator stays lit over the veil with no special-casing. Any approach
that dimmed a wrapper around everything-but-the-input would have veiled it.

**The blur is gated on the unprefixed property, and the prefix is deliberately
omitted:**

```css
@supports (backdrop-filter: blur(2px)) { … }
```

This is not a stylistic choice. The guest's engine drops unprefixed
`backdrop-filter` at parse time and understands only `-webkit-backdrop-filter`,
while every engine new enough to composite this cheaply supports the unprefixed
spelling. So the query that asks "do you understand modern `backdrop-filter`" also
answers "are you new enough to paint it" — no user-agent sniffing and no version
list. Adding the `-webkit-` prefix would switch the blur back on for precisely the
machine that cannot afford it.

It is a capability proxy for performance, and it should be read as one. If a
future engine supports the unprefixed property but paints it slowly, this gate
will let it through.

Where the blur applies, the veil carries **less** opacity — the blur does the
receding — which leaves more contrast behind on the engines that can afford both.

**The bar rises.** Recession alone made the field retreat without making the bar
the protagonist, which is what was actually asked for. On focus it lifts 3px,
gains a hair of scale, takes `--ink-3` on its hairline, and steps up to a new
`--e-lift` elevation. Transform, border-colour and box-shadow only.

**`prefers-reduced-transparency` removes the veil entirely.** This is the query
that actually governs a veil and a blur. All four `prefers-reduced-motion` blocks
in the tree clamp `animation-duration`, `animation-iteration-count` and
`transition-duration` and nothing else — so under reduced motion a veil would have
snapped fully on rather than being suppressed. Without the veil the bar still
lifts and gains weight, which is the part that carries the meaning.

## Consequences

**Positive**

- The request is delivered on both surfaces, honestly differentiated: a capable
  browser blurs, the guest recedes in ink. Neither looks broken.
- No layout property animates. The veil is opacity, the bar is transform.
- The recession is arithmetic, and a regression in either theme fails the build
  with the ratio in the message.
- `prefers-reduced-transparency` now exists in this codebase, where it did not.

**Negative — accepted**

- **The guest gets the restrained version, and it is restrained.** The veil plus
  the lift read as tasteful rather than dramatic. That is the cost of a renderer
  with no GPU, and the alternative was an effect that drops frames on the one
  machine SairiOS actually runs on.
- **Blur is back in the vocabulary.** ADR 0014's argument against it was sound and
  is not withdrawn; this is one transient, non-structural use with a hard gate.
  A second use should have to argue for itself here.
- **Background text is deliberately unreadable while focused.** Justified above,
  but it is a real departure and it is written down rather than assumed.
- **The gate is a proxy.** See above.

## Also fixed, because a motion pass is the right time

`.s-conv__fill` transitioned `width` for 720ms on every convergence change —
rule 1 broken on screen, a full-width repaint per frame. It is `scaleX` now.

`.s-conv__meridian` still transitions `left`, knowingly: a 1px rule cannot be
moved by a transform without a width reference, percentage `translateX` is
relative to the element's own 1px, and container-query units are unverified on the
guest's engine. It is the single named exception in the layout-transition test,
which asserts the exception still exists so the carve-out cannot outlive it.

## Not fixed here, and worth its own change

`@keyframes sairi-indeterminate` in `packages/ui-components/src/styles.css`
animates `margin-left` on a `1.6s linear infinite` loop — per-frame layout,
forever. It is reachable by any validated agent document, because `indeterminate`
is a boolean in the SairiUI schema. On a software-rendered ARM VM that is a
model-triggerable performance sink, and the fix is one line: translate the fill
and clip it to the track.

## Verification

`tokens.test.ts` asserts the veil keeps the strongest ink above 3:1 in both
themes, that it recedes body ink by a real margin (an alpha too timid to notice
fails as surely as one too strong), that `--z-veil` sits between the regions and
the bar, that the blur is gated on the unprefixed property and never adds the
prefix, that `prefers-reduced-transparency` is answered, and that nothing
transitions a layout property except the one recorded exception. The
layout-transition assertion was checked by breaking it on purpose.

Captured on the guest console with the focus state forced on: the field recedes
and the bar lifts with a visible shadow. Not verified: the blur path, which by
construction cannot appear on the guest and needs a modern browser to see; the
transition itself, since a screenshot has no time axis; and the frame cost, which
remains unmeasured.
