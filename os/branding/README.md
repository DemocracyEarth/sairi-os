# os/branding/

The visual constants of SairiOS: the palette, the mark, the wallpaper.

These live in `os/` because the OS layer needs them at boot, before any product code
runs.

**There is one set of design tokens, and it is not in this directory.**
`packages/ui-components/src/tokens.css` is canonical — it is what the shell and the
component catalog actually render from. `palette.css` here is **generated from it** by
`build-palette.mjs` and exists only so that OS-level chrome can use the same values
without importing from a workspace package.

This used to be two hand-maintained files. They shared eighteen token names and disagreed
on all eighteen values — `--sairi-accent` was `#3a6ea5` here and `#3b6ea5` there — and
because nothing imported this one, nothing ever caught it. A greeter styled from this file
would not have matched the desktop it was a greeter for.

It also carried sixty-five tokens the product does not use: a parallel vocabulary
(`--sairi-ink`, `--sairi-space-md`, `--sairi-radius-md`) that appeared nowhere outside
this file and the examples in this README. Those are gone. The shell calls text
`--sairi-text*`; there is no `--sairi-ink*`.

Regenerate with `npm run build:palette`. `os/branding/palette.test.ts` fails if the
committed file has drifted from its source, so the two cannot come apart again.

## The language, stated once

Early Macintosh clarity. Late-80s and early-90s UNIX workstation utility. Modern
typography.

What that means concretely:

- **Warm off-white surfaces.** `#f4f1ea`, not `#ffffff` and not grey. It reads as paper.
- **Charcoal type.** `#1f1d1a`, never `#000000`. Pure black on a warm surface looks like
  a hole punched in the page.
- **Thin borders doing structural work.** 1px rules define panels. This is the era being
  referenced: the interface is drawn, not shaded.
- **Subtle shadows.** One offset, one blur, alpha under 15%. Shadows separate layers;
  they do not create depth as an effect.
- **One muted blue accent.** `#3a6ea5`. Focus, selection, links, and the single primary
  action in any view. If two things on screen are blue, one of them is wrong.
- **Compact status indicators.** A 7px dot and a 13px label. Status is ambient
  information, not a banner.
- **Minimal animation.** 110ms to 180ms, and only as feedback for something the user did.

What it explicitly is not:

- No AI gradients. No purple-to-blue anything.
- No glassmorphism, no blur-behind, no translucency as decoration.
- No neon, no cyberpunk, no dark-mode-as-personality.
- No chat bubbles as the dominant interface.
- No app-launcher grid of rounded-square icons.

## Files

### `palette.css`

**Generated. Do not edit.** Source: `packages/ui-components/src/tokens.css`.
Generator: `build-palette.mjs`. Regenerate with `npm run build:palette`.

Every design token the shell uses, prefixed `--sairi-`, with light values on `:root` and
dark values on `:root[data-theme='dark']` — identical to the source, because they are
copied from it rather than written twice.

It differs from its source in exactly one way, and that difference is the reason the file
exists at all. `tokens.css` has no `prefers-color-scheme` block on purpose: the shell
resolves "match system" in JavaScript and always writes a concrete `data-theme`, so there
is one source of truth and the user can override the system. Session chrome — a greeter, a
login screen, a splash — has no JavaScript to do that with, so this file adds the media
query, scoped `:root:not([data-theme='light'])` so an explicit light choice still survives
a dark system setting. The `prefers-reduced-motion` reset is carried across too.

Token groups, as they actually exist:

| Prefix                                                                                                | Covers                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `--sairi-desktop*`, `--sairi-chrome`, `--sairi-surface*`                                              | backgrounds, furthest back to nearest front |
| `--sairi-text*`                                                                                       | type, from strong to faint, plus inverse    |
| `--sairi-border*`                                                                                     | rules, including the focus ring             |
| `--sairi-accent*`                                                                                     | the single accent hue and its tints         |
| `--sairi-ok`, `--sairi-warn`, `--sairi-error`, `--sairi-pending`, `--sairi-idle`                      | status                                      |
| `--sairi-ephemeral*`, `--sairi-persistent*`, `--sairi-crystallized*`                                  | context type                                |
| `--sairi-shadow*`                                                                                     | three elevations, no more                   |
| `--sairi-term*`                                                                                       | terminal colours                            |
| `--sairi-font*`, `--sairi-text-*` sizes                                                               | typography                                  |
| `--sairi-space-1`…`-6`                                                                                | a 4px grid                                  |
| `--sairi-radius*`                                                                                     | small, default, large                       |
| `--sairi-menubar-height`, `--sairi-titlebar-height`, `--sairi-statusbar-height`, `--sairi-dock-width` | fixed chrome metrics                        |

Use it by importing the file and then referring only to tokens:

```css
@import url('/usr/share/sairios/palette.css');

.panel {
  background: var(--sairi-surface-raised);
  color: var(--sairi-text);
  border: 1px solid var(--sairi-border);
  border-radius: var(--sairi-radius);
  box-shadow: var(--sairi-shadow);
  padding: var(--sairi-space-4);
  font: var(--sairi-text-base) var(--sairi-font);
}
```

Never write a hex value in a component. If a colour you need is not a token, add it to
`tokens.css` and regenerate — not to this file, which is overwritten, and not inline.

The one deliberate exception is `sairios-wallpaper.svg`, which hardcodes literal values
because it is rasterised outside any document that could define custom properties.

### `sairios-logo.svg`

The logo. Square `viewBox` (`0 0 640 640`): the word _sairi_ in a geometric lowercase
under a blue-green-yellow-orange spectrum, _OS_ in grey beneath it, inside a rounded
square outlined in the same spectrum.

**It contains no text element.** Every letterform is drawn as geometry — full circles,
vertical bars and two-lobed arcs, which is what a geometric sans is made of. A `<text>`
element would render in whatever font the machine happens to have, and the guest is a
minimal Debian carrying essentially DejaVu, a humanist face that would make the wordmark
wrong exactly where it matters most. Drawn this way the logo is identical on the VM, in a
browser, on GitHub and at favicon size, and it has no font dependency at all.

**The interior is transparent, not white.** The original artwork sits on a white page,
but a white plate becomes a bright card on the dark theme. Left open, the logo takes the
surface it is placed on, so one file serves both themes.

Two lockups, because one cannot serve the whole size range:

| Variant   | Contains               | Use from |
| --------- | ---------------------- | -------- |
| `full`    | frame, _sairi_, _OS_   | ~96px    |
| `compact` | frame and _sairi_ only | ~18px    |

Below about 96px the grey _OS_ stops being type and becomes four smudged pixels, so
`compact` drops it and scales the wordmark to fill the frame instead of shrinking
everything together. The React component
[`packages/ui-components/src/logo.tsx`](../../packages/ui-components/src/logo.tsx) carries
the same geometry and takes a `variant` prop; this file is the `full` lockup and the
source of truth for both.

Where it appears: the menu bar (compact, 20px), first-run setup (full, 56px), the shell's
favicon (inlined as a `data:` URI in `apps/shell/index.html`, because the desktop should
not need a second request before it paints), the session icon installed to
`/usr/share/icons/hicolor/scalable/apps/sairios.svg`, and the README.

If you change the geometry, change it here first and port it to `logo.tsx`. There is no
build step tying them together — a test would need a headless renderer to compare them
meaningfully, and the geometry is stable enough that the comment in each file naming the
other is the cheaper guard.

### `sairios-mark.svg`

Square `viewBox` (`0 0 64 64`), `currentColor`, no gradients, no filters, no embedded
text. It is a window frame containing two tiles: one outlined, one filled. Two contexts,
one of them in focus.

Colour it by setting `color` on an ancestor:

```html
<span style="color: var(--sairi-text)">
  <img src="/branding/sairios-mark.svg" width="24" height="24" alt="SairiOS" />
</span>
```

An `<img>` will not inherit `currentColor`. Inline the SVG, or use it via a CSS `mask`,
when you need the colour to follow the theme:

```css
.mark {
  background: currentColor;
  mask: url('/branding/sairios-mark.svg') center / contain no-repeat;
}
```

Uses: anywhere a single-colour glyph is wanted — a monochrome context, a mask, a place
that must follow `currentColor`. The geometry was drawn so strokes land on whole or half
pixels at 64px; it stays legible down to about 16px, below which the close box and the
tile outline merge.

Do not add a wordmark to this file. That is what `sairios-logo.svg` is for, and it
superseded this file as the favicon and session-icon source — the mark remains installed
alongside it and is still the right choice when the colour has to be inherited, which a
gradient logo can never do.

### `sairios-wallpaper.svg`

16:9, `preserveAspectRatio="xMidYMid slice"` so a non-16:9 display crops rather than
stretches. A 60px grid, corner registration brackets, the mark's window enlarged, and a
measuring rule across the lower third. The highest-contrast element is roughly 8% against
the background; it is meant to be looked past, not at.

It carries the light palette in presentation attributes and the dark palette in a
`prefers-color-scheme` block, because some SVG rasterisers ignore `<style>` entirely.
That redundancy is intentional. If you change one, change both.

To rasterise for a compositor that wants a bitmap:

    rsvg-convert -w 3840 -h 2160 os/branding/sairios-wallpaper.svg -o wallpaper@2x.png

## Adding an asset

Three questions, all of which must be answered yes:

1. Does the OS layer need it before product code runs? If not, it belongs with the
   product.
2. Can it be drawn as geometry rather than shipped as a bitmap? Bitmaps in this directory
   need a reason.
3. Does it use the palette, and only the palette?

## Verification status

Nothing here has been rendered on a display, rasterised to a file, or measured. The
geometry is arithmetic, not observation, and `os/README.md` says the same. XML
well-formedness IS checked, and both SVGs pass.

| Item                                         | Status                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sairios-mark.svg` structure                 | **Not verified.** Written by hand; the geometry is arithmetic, not observation. Nothing here was rendered, rasterised or measured on this host. `os/README.md` says the same. |
| `sairios-wallpaper.svg`                      | **Never rendered.** Composed from arithmetic.                                                                                                                                 |
| Rasterisation with `rsvg-convert` or `resvg` | **Not run.** Neither is installed on the authoring host.                                                                                                                      |
| Contrast ratios in `palette.css`             | **Not measured.** Values were chosen to clear WCAG AA by construction. Verify before shipping.                                                                                |
| Dark palette checked on a real panel         | **Not done.**                                                                                                                                                                 |
| `palette.css` parsed by any build            | **Not done.** No consumer imports it yet.                                                                                                                                     |
| XML well-formedness of both SVGs             | **Checked, passes.** Both files parse with Python's `xml.dom.minidom`. `sairios-wallpaper.svg` previously did not: an XML comment contained `--`. That is fixed.              |

To verify:

    rsvg-convert -w 512 -h 512 os/branding/sairios-mark.svg -o /tmp/mark.png
    rsvg-convert -w 1920 -h 1080 os/branding/sairios-wallpaper.svg -o /tmp/wall.png
    npx prettier --check os/branding/palette.css
    python3 -c "import sys,xml.dom.minidom as m; [m.parse(p) for p in sys.argv[1:]]" os/branding/*.svg

The parse command has been run against both SVGs: it prints nothing and exits 0.
Correct output for the first two is a PNG of the stated size and exit status 0. The mark
should be a window outline with a filled square at lower right; if you get a blank image,
`currentColor` resolved to transparent and you need `--stylesheet` or an explicit
`color`.
