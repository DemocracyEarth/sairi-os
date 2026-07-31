# os/branding/

The visual constants of SairiOS: the palette, the mark, the wallpaper.

These live in `os/` because the OS layer needs them at boot, before any product code
runs. `palette.css` is the reference for OS-level and session chrome. Nothing imports it:
the shell renders with its own copy of the tokens in
`packages/ui-components/src/styles.css` (`apps/shell/src/main.tsx` imports
`@sairios/ui-components/styles.css`). The two files are kept in step by hand.

They are not in step today. Nine tokens are declared in both files and all nine have
different values: `--sairi-surface` (`#f4f1ea` here, `#fbfaf8` there),
`--sairi-surface-raised` (`#fbf9f4` / `#ffffff`), `--sairi-surface-sunken` (`#e9e4d9` /
`#eae7e1`), `--sairi-border` (`#d5cfc2` / `#d6d2ca`), `--sairi-border-strong` (`#b0a999` /
`#b4afa4`), `--sairi-accent` (`#3a6ea5` / `#2f5d8c`), `--sairi-ok` (`#3f6b4a` / `#3a6b4c`),
`--sairi-warn` (`#8a6a1f` / `#8a6a1c`) and `--sairi-font-mono` (different font stack
order). No other name appears in both: this file calls text `--sairi-ink*`, the shell's
file calls it `--sairi-text*`. Until one file imports the other, or a build step generates
one from the other, expect them to drift.

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

Every design token, prefixed `--sairi-`. Light values on `:root`, dark values in a
`prefers-color-scheme: dark` block, and explicit `:root[data-theme="light"]` /
`:root[data-theme="dark"]` blocks so a manual theme toggle beats the system preference in
both directions.

Token groups:

| Prefix                                                                                            | Covers                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `--sairi-surface-*`                                                                               | backgrounds, from sunken well to overlay          |
| `--sairi-ink-*`                                                                                   | text, from strong headings to faint timestamps    |
| `--sairi-border-*`                                                                                | rules and their widths                            |
| `--sairi-accent-*`                                                                                | the single accent hue and its tints               |
| `--sairi-ok/warn/danger-*`                                                                        | status                                            |
| `--sairi-policy-*`                                                                                | permission policy: allow, ask, deny               |
| `--sairi-context-*`                                                                               | context type: ephemeral, persistent, crystallized |
| `--sairi-shadow-*`                                                                                | three elevations, no more                         |
| `--sairi-font-*`, `--sairi-text-*`, `--sairi-leading-*`, `--sairi-weight-*`, `--sairi-tracking-*` | typography                                        |
| `--sairi-space-*`                                                                                 | a 4px grid                                        |
| `--sairi-radius-*`                                                                                | 0, 2, 3, 5px, and one full for status dots        |
| `--sairi-focus-ring-*`                                                                            | focus, always visible                             |
| `--sairi-duration-*`, `--sairi-easing-*`                                                          | motion, zeroed under `prefers-reduced-motion`     |
| `--sairi-titlebar-height`, `--sairi-statusbar-height`, `--sairi-indicator-size`                   | fixed chrome metrics                              |

Use it by importing the file and then referring only to tokens:

```css
@import url('/branding/palette.css');

.panel {
  background: var(--sairi-surface-raised);
  color: var(--sairi-ink);
  border: var(--sairi-border-width) solid var(--sairi-border);
  border-radius: var(--sairi-radius-md);
  box-shadow: var(--sairi-shadow-sm);
  padding: var(--sairi-space-md);
  font: var(--sairi-weight-regular) var(--sairi-text-sm) / var(--sairi-leading-normal)
    var(--sairi-font-sans);
}
```

Never write a hex value in a component. If a colour you need is not a token, the right
move is to add a token here, not to inline it there.

The one deliberate exception is `sairios-wallpaper.svg`, which hardcodes literal values
because it is rasterised outside any document that could define custom properties.

### `sairios-mark.svg`

Square `viewBox` (`0 0 64 64`), `currentColor`, no gradients, no filters, no embedded
text. It is a window frame containing two tiles: one outlined, one filled. Two contexts,
one of them in focus.

Colour it by setting `color` on an ancestor:

```html
<span style="color: var(--sairi-ink)">
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

Uses: window chrome, the session splash, favicon source, documentation headers. The
geometry was drawn so strokes land on whole or half pixels at 64px; it stays legible down
to about 16px, below which the close box and the tile outline merge. Do not add a
wordmark to this file. If a lockup is needed, compose it from this mark plus type set in
`--sairi-font-sans` at `--sairi-weight-medium`.

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

Nothing here has been rasterised to a file or measured. The only asset anyone has looked
at is `sairios-mark.svg`, rendered once in a browser while it was being drawn; everything
else is arithmetic. XML well-formedness is checked, and both SVGs pass.

| Item                                         | Status                                                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sairios-mark.svg` structure                 | Rendered once in a browser during authoring. Frame, title rule, close box and both tiles appeared as intended. Not checked at small sizes, not checked against a light background. |
| `sairios-wallpaper.svg`                      | **Never rendered.** Composed from arithmetic.                                                                                                                                      |
| Rasterisation with `rsvg-convert` or `resvg` | **Not run.** Neither is installed on the authoring host.                                                                                                                           |
| Contrast ratios in `palette.css`             | **Not measured.** Values were chosen to clear WCAG AA by construction. Verify before shipping.                                                                                     |
| Dark palette checked on a real panel         | **Not done.**                                                                                                                                                                      |
| `palette.css` parsed by any build            | **Not done.** No consumer imports it yet.                                                                                                                                          |
| XML well-formedness of both SVGs             | **Checked, passes.** Both files parse with Python's `xml.dom.minidom`. `sairios-wallpaper.svg` previously did not: an XML comment contained `--`. That is fixed.                   |

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
