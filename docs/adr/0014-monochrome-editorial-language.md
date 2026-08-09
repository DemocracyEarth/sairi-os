# 0014. A monochrome, editorial visual language with one accent

- Status: Accepted
- Date: 2026-08-09
- Deciders: SairiOS founding engineering

## Context

The Sairi OS surface shipped with a dark, spectral, cinematic language: a near-black ground,
seven hues each carrying a meaning, volumetric glow, drifting coloured light fields and
backdrop blur on four surfaces. It was built to the brief in
`.claude/skills/sairi-ui-architect/SKILL.md`, which mandated exactly that.

It photographed well and it decorated indiscriminately. A knowledge graph glowed and a
warning glowed, so neither glow meant anything. Worse, hue was spent on **identity** — the
research context was violet, travel cyan, an incident coral — which is information the title
already carries, and it left nothing to say "this needs a human" with. `--accent` was set per
context, so every focus ring and active row inherited the workspace's colour.

The revised brief: monochrome-first, off-white and graphite and charcoal, one restrained
accent, crisp geometry, editorial typography, information density without clutter, no
glassmorphism. _What if the original Macintosh team had kept evolving the same design language
for forty years, without ever passing through skeuomorphism, glassmorphism, or generic SaaS?_

One question the brief did not settle: "off-white, graphite, charcoal" reads as either a light
or a dark system. 1984 Mac, Braun and editorial layout pull light; NeXTSTEP and the existing
build pull dark.

## Decision

**Light-first, with dark as a re-picked peer.** Off-white paper `#F7F6F3`, a four-step
graphite ink ramp, charcoal chrome. The dark theme is not an inversion: ink on paper and paper
on ink are different optical problems, so every value is chosen again.

**Exactly one accent.** Braun signal orange, and `--accent` is now a constant rather than a
per-context variable. It appears only where the machine needs a human.

**Convergence is drawn in ink, not light.** A provisional panel gets a dashed hairline and
held-back ink; a resolved one gets a full-weight rule, black ink and a ledger line under its
head. The panel sets like type as it becomes certain.

**Tones are a value ramp for marks; text uses the ink ramp.** The seven hues became four
monochrome values spaced to clear 3:1 and stay separable, which is how printed instrumentation
differentiated series before colour was cheap.

**No blur, no glow, no drifting fields.** Hierarchy is rules, ink and space.

## Consequences

**The change was almost entirely in tokens.** The four context interiors held 906 token
references against 21 hardcoded colours, so redefining `tokens.css` converted all of them.
That is a vindication of the original token discipline, not of this change.

**Monochrome survives conditions colour does not.** The convergence signal now works in
greyscale, when printed, at low brightness, and for the eight percent of men who cannot
separate red from green. Glow did none of that.

**An accessibility audit fell out of it, and found real defects.** Contrast is arithmetic, so
it can be checked without looking. `--ink-4` was used as `color:` 79 times at **2.42:1** —
a failure the previous dark theme had hidden. The ramp was re-spaced so every text step clears
4.5:1 in both themes. Braun orange is 3.75:1 on paper, right for a mark and too light for small
text, so `--signal-ink` exists for words. Three places used a chart tone as a paragraph colour.
And the navigation rail drew recency with `opacity`, which multiplies straight through whatever
contrast a token was chosen for — recency is a step on the ink ramp now.

**The brand mark had to be redrawn.** A three-stop gradient is a grey smear in monochrome. It
is now a dashed square containing a solid one: the system's own convergence idea, at 18px.

**Density is a commitment.** Radii dropped from 6/12/18/26px to 2/3/5/8px and capsules were
cut to rectangles. This will look wrong to anyone expecting contemporary SaaS, which is the
intent, but it means new components cannot be dropped in from a component library without
being re-cut.

**Colour is now a scarce resource that has to be defended.** The accent's whole value is that
it always means something. There is no lint rule enforcing that; the next person who reaches
for orange because a button looked plain will quietly spend it.

**The skill file was the source of the old direction and had to change with the code.** It
mandated "deep midnight navy", the seven hues, "soft volumetric illumination" and "ambient
animated backgrounds". Leaving it would have regressed the design on the next session that
loaded it. It now carries the new palette, the mark-versus-text contrast rule, and an explicit
list of what not to build.

**Not verified visually.** The browser pane would not composite during this work, so the
redesign and its polish pass were done as contrast arithmetic and source audit. Every claim
here about contrast is computed and every claim about what shipped is grepped from the built
bundle — but nobody has yet looked at the result. Whether the density reads, whether the ledger
rule is too heavy, and whether the dark counterpart feels like a peer are all open.
