# ADR 0016 — The shell serves its own typefaces

**Status:** accepted
**Date:** 2026-08-10
**Reverses** an undocumented decision recorded only as a comment in
`apps/shell/src/sairi/tokens.css`. Related: [ADR 0014](0014-monochrome-editorial-language.md)
(the visual language this typography implements), [ADR 0011](0011-same-origin-service-proxy.md)
(why there is one origin to serve from).

## Context

The monochrome language of ADR 0014 puts the whole expressive burden on
typography: colour communicates state and nothing else, so weight, spacing and
scale carry the rest. The brief names three families — Inter for body, **Inter
Tight** for display, JetBrains Mono for code — and `sairi.computer` serves
exactly those, at Inter 400/500/600, Inter Tight 500/600/700, JetBrains Mono
400/500.

The token layer named them and left it there, with a comment arguing the case:

> System stack: nothing to download, no layout shift, and the CSP forbids a
> foreign font host anyway.
> Display wants the tighter cut. Falls through to Inter, which every machine that
> matters already has […] the guest installs both families from apt.

Three of those clauses turned out to be false, and the fourth is an argument for
the opposite of what it concluded.

**No apt package for Inter Tight exists.** Not in bookworm, not in any Debian
suite, no package name and no file name. `fc-list "Inter Tight"` on the running
guest returns nothing. The guest installs `fonts-inter` and `fonts-jetbrains-mono`
— one of the two families the comment claimed.

**"Every machine that matters" does not have Inter.** The operator's own machine
has none of the three. Body text on the remote surface had never once resolved to
Inter.

**`--font-display` was consumed by nothing.** Declared once, referenced nowhere;
`grep -rn 'var(--font-display'` returned empty. The display headings set
`--t-display` and `--track-display` and inherited the body family. Inter Tight
was never requested by any surface, so no amount of installing it anywhere would
have changed a pixel. The design pass that introduced the token shipped it dead.

**And the shell is rendered on two surfaces, not one:**

1. the guest's kiosk browser — `cog`, WPE WebKit 2.38.6, under weston;
2. an ordinary browser on the operator's machine, over the tunnel.

A font in the guest's fontconfig serves surface 1 and does **exactly nothing**
for surface 2. Not less, not partially: family resolution happens in the process
laying out the text, and an HTTP response only ever _names_ families. The two
surfaces cannot be served by one installation.

## Decision

The shell serves the three families itself: one variable woff2 per family,
vendored into `apps/shell/src/sairi/fonts/`, declared with `@font-face`, emitted
by Vite to `/assets/*.woff2`. And `var(--font-display)` is wired into the rules
that set the display size, because without that the rest is theatre.

`font-src 'self'` — already in the policy — permits precisely this and no foreign
host. The comment's last clause was right about the CSP and drew the wrong
conclusion from it: the policy does not forbid webfonts, it forbids _other
people's_ webfonts.

Four decisions inside that:

**Variable, latin, roman only.** One file per family covers every weight the
design uses; 133 KB for all three. No italic ships — the only italics in the
shell are one-line empty-state labels, where a synthesised oblique is
indistinguishable and 145 KB is not worth spending.

**Vendored files, not npm packages.** A font is not a dependency that needs
resolving or updating, and three `node_modules` entries to obtain three static
files is attack surface for nothing. Digests are recorded in `fonts/README.md`
and asserted by the test suite, so the blobs stay auditable.

**An unmodified third-party build, under its unchanged name.** All three are
OFL-1.1, whose clause 2 permits bundling provided the notice travels with the
copy — hence the three `OFL-*.txt` files. Subsetting or converting would make it
a "Modified Version" by the licence's own definition, which collides with the
Reserved Font Name that `rsms/inter`'s README asserts on "Inter" and its own
`OFL.txt` does not declare. Redistributing someone else's finished build avoids
that contradiction rather than reasoning about it.

**`assetsInlineLimit: 0`.** Vite inlines assets under 4096 bytes as `data:`
URIs, and `font-src 'self'` has no `data:` while `img-src` does — the asymmetry
is deliberate. An inlined font would be a CSP violation whose only symptom is a
fallback typeface. Closed structurally, the way ADR 0009 closed the
validator-versus-policy gap. Fix the bundler, never the policy.

## Consequences

**Positive**

- The display cut is correct on both surfaces, from one mechanism.
- Both surfaces render the _identical binary_. Debian's `fonts-inter` is
  `4.0~beta7`; the vendored Inter is `4.001`. They are not the same metrics, so
  even the family the guest did have was rendering differently from the landing.
- The guest's font packages become fallback only. They are left installed: they
  cost nothing and they are what shows if a woff2 ever fails to load.
- No network at page load, no third-party host, no CSP change.

**Negative — accepted**

- **The first tracked binaries in the repository.** 133 KB of opaque bytes in
  git, mitigated by recorded digests and a test that checks them, not removed.
- **FOUT on first paint.** This is the one true clause in the comment being
  reversed. `font-display: swap` means a flash of the fallback, and the guest
  software-renders (`weston --use-pixman`, no GL), so first paint there is not
  fast. Accepted because the alternative on the remote surface was not "no
  shift" but "permanently the wrong typeface".
- **A font parser now processes repository bytes in the guest.** WPE WebKit
  decodes woff2 via `libwoff1` either way; what changes is that the file is ours.
  Not a new capability, and not a new trust boundary — the bytes are as trusted
  as the JS bundle beside them.
- **An OFL obligation travels with the repo.** Deleting an `OFL-*.txt` while
  keeping its font is a licence violation. The test asserts all three exist.
- **Inter Tight is a dead end upstream.** Version 3.004, forked from Inter in
  mid-2022, archived December 2022, explicitly not tracking Inter, with a smaller
  glyph set. It will not improve. Pinning a frozen font is the honest description
  of what shipped.

**No security posture change.** No CSP directive moved, no trust boundary moved,
no new origin is contacted. SECURITY.md needs no edit, and this paragraph exists
so the next reader does not assume the policy was loosened to make fonts work.

## Alternatives considered

**Add `fonts-inter-tight` to the guest's cloud-init package list.** Not merely
insufficient — actively dangerous. The package does not exist, and cloud-init
installs the entire `packages:` list in a single `apt-get` invocation, so one
unresolvable name means _nothing_ installs: no weston, no cog, no xwayland, no
`dbus-user-session`. cloud-init logs the failure and continues into `runcmd`, so
the guest boots to a black screen with the cause several hundred log lines away.
Traded a whole graphical session for a typeface on one surface.

**Install the font into the image at build time.** `vm/qemu/build-image.sh` has
no mount, chroot, libguestfs or privileged step at all — by design; its stated
contract is that it does not put SairiOS into the image. This would mean adding a
libguestfs toolchain to a macOS-arm64 host that currently needs only `curl`,
`qemu-img` and a checksum tool. And it still does nothing for the remote browser.

**Point at Google Fonts, like the landing page does.** Would require adding
`fonts.googleapis.com` and `fonts.gstatic.com` to a policy whose whole shape is
`default-src 'none'`. Trading a real boundary for a typeface, and making a page
load reach the network in a system whose default mode reaches nothing.

**Use `Inter Display`, which the guest already has.** Tempting and wrong for two
reasons. It is a different intervention — the large end of Inter 4's `opsz` axis,
with letterforms redrawn for size — not Inter Tight's tighter spacing, and the
two are not interchangeable. And it is still absent from the operator's machine,
so it fixes nothing remotely. Worth noting the constraint Inter Tight was built
to work around, Google Workspace's lack of letter-spacing control, is one CSS
does not have; if the display cut is ever revisited, that is the thread to pull.

**Do nothing.** The status quo, and cheaper than it looks only because the token
was dead. As a decision it locks in a permanent disagreement between the two
surfaces and does not even deliver its own stated fallback, since there is no
Inter on the remote machine to fall back to.

## Verification

Asserted by `apps/shell/src/sairi/fonts.test.ts`: the digests, the OFL files, the
axis ranges, no `data:` URI, no foreign host, and that every display-sized rule
consumes `var(--font-display)` — that last one being the failure that hid all the
others. What a test cannot assert is what a screen shows; the commit that landed
this records the guest and remote checks actually performed.
