# Vendored typefaces

Three font binaries, tracked in git. The first binary assets this repository has
ever carried, so the reasoning is written down rather than assumed.

## Why they are here and not installed

The shell is a web page, and it is rendered on **two** surfaces:

1. the guest's kiosk browser (`cog`, WPE WebKit, on the VM console);
2. an ordinary browser on the operator's own machine, reached over the tunnel.

A font installed into the guest's fontconfig serves surface 1 and does **exactly
nothing** for surface 2 — family resolution happens in the process laying out
the text, and the HTTP response only ever _names_ families. So a font shipped by
the shell is the only mechanism that reaches both, and `font-src 'self'` in the
production Content Security Policy already permits precisely this and nothing
else. See [ADR 0016](../../../../../docs/adr/0016-self-hosted-typefaces.md).

Debian has no package for Inter Tight in any suite, so there was never an
`apt` option for it. There is one for Inter (`fonts-inter`), but it is
`4.0~beta7` — a different build from the `4.001` here, with different metrics.
Serving the binary means both surfaces render the identical file.

## What each file is

| File                                     | Family           | Version | `wght` axis | Bytes  |
| ---------------------------------------- | ---------------- | ------- | ----------- | ------ |
| `inter-latin-wght-normal.woff2`          | `Inter`          | 4.001   | 100–900     | 48,256 |
| `inter-tight-latin-wght-normal.woff2`    | `Inter Tight`    | 3.004   | 100–900     | 44,872 |
| `jetbrains-mono-latin-wght-normal.woff2` | `JetBrains Mono` | 2.211   | 100–**800** | 40,404 |

Read out of each file's `name` and `fvar` tables, not copied from the source
listing. JetBrains Mono stops at 800; the `@font-face` rule says `100 800` for
that family and `100 900` for the other two, because a declared range wider than
the axis makes the browser synthesise weights it could have interpolated.

These are the three families [sairi.computer](https://sairi.computer) requests,
at the weights it uses (Inter 400/500/600, Inter Tight 500/600/700, JetBrains
Mono 400/500) — one variable file per family covers every weight in one request.

**Latin, roman only.** No italic file ships. The only italics in the shell are
one-line empty-state labels (`.s-empty`, `.sairi-empty`), where a synthesised
oblique is indistinguishable at that size and 145 KB is not worth spending. Add
the italic faces if real italic body copy ever appears.

## Provenance

Fetched from Fontsource at a pinned version — an already-built, unmodified
artifact rather than a subset produced here. The OFL treats a format conversion
or subset as a "Modified Version", and `rsms/inter`'s README asserts a Reserved
Font Name on "Inter" that its own `OFL.txt` does not declare. Redistributing
someone else's unmodified build under its unchanged name stays clear of that
contradiction entirely.

```
https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2
https://cdn.jsdelivr.net/npm/@fontsource-variable/inter-tight@5.3.0/files/inter-tight-latin-wght-normal.woff2
https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2
```

Verify any copy against these digests:

```
3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62  inter-latin-wght-normal.woff2
77fefe8ca19b9f69b5284832c519e0493127c1f091f0a8936884be7721c4e618  inter-tight-latin-wght-normal.woff2
18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e  jetbrains-mono-latin-wght-normal.woff2
```

```bash
shasum -a 256 apps/shell/src/sairi/fonts/*.woff2
```

Fetched as files rather than added as npm dependencies deliberately: a font is
not a dependency that needs resolving or updating, and three packages in
`node_modules` to obtain three static files is attack surface for nothing.

## Licence

All three are under the SIL Open Font License 1.1, whose clause 2 permits
bundling and redistribution "provided that each copy contains the above
copyright notice and this license". That is what `OFL-inter.txt`,
`OFL-inter-tight.txt` and `OFL-jetbrains-mono.txt` are for. They travel with the
binaries; do not delete one without deleting its font.

- Inter — © 2016 The Inter Project Authors. Designed by Rasmus Andersson.
- Inter Tight — © 2022 The Inter Project Authors. A Google Fonts fork of Inter
  with tighter spacing, engineered by Rosalie Wagner. Frozen at 3.004 (December
  2022); it does not track Inter and never will.
- JetBrains Mono — © 2020 The JetBrains Mono Project Authors.

## What Inter Tight actually is, since it is easy to get wrong

Inter Tight is **not** Inter's display cut. It is a 2022 fork of Inter with the
sidebearings pulled in — −48 units per side at Regular on a 2048 UPM em, about
8.8% narrower advances — made because Google Workspace offers no letter-spacing
control. Its glyph set is smaller than current Inter's and it is archived.

**Inter Display** is the different thing: the large end of Inter 4's `opsz`
axis (14→32), shipped as a second static family, with letterforms actually
redrawn for size rather than merely spaced tighter. Debian's `fonts-inter`
includes it; Inter Tight has no `opsz` axis at all.

The design brief names Inter Tight and the landing page serves Inter Tight, so
that is what ships here. Worth knowing that the constraint Inter Tight was built
to work around — no letter-spacing control — is one CSS does not have.
