# 0009. Precompile the SairiUI validator instead of allowing eval

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

[ADR 0003](0003-declarative-adaptive-ui.md) makes JSON Schema validation the boundary between
model output and the screen, and that check runs in three places: the agent bridge, the
context service, and the renderer inside the desktop shell.

The shell ships a Content Security Policy of `script-src 'self'` with no `'unsafe-eval'`. It
renders agent-produced _descriptions_, never agent-produced code, so it should need neither
`eval` nor remote scripts.

AJV compiles a JSON Schema by generating JavaScript source and calling `new Function`. That is
runtime code generation, and the policy refuses it. This was not a theoretical concern: the
first production build of the shell mounted nothing at all, silently, because the validator
module threw while the policy blocked its compilation step. The development server did not
show the problem, because Vite's React Refresh preamble already required the policy to be
absent there.

So the choice was forced: relax the policy, or stop compiling at runtime.

## Decision

Precompile the SairiUI validator at build time into a standalone, eval-free ES module, using
AJV's standalone code generation. The shell imports the generated module; no schema is
compiled in the browser.

Supporting details:

- The generator is `packages/adaptive-ui-schema/scripts/build-validator.mjs`. It normalizes
  the `require(...)` calls AJV still emits under `esm: true` into real imports, and **asserts**
  that the output contains no `new Function`, no `eval(`, and no `require(`. A future AJV
  release cannot silently reintroduce runtime codegen.
- The generated file is committed. A test regenerates it and fails if it differs, so it cannot
  drift away from the schema, and a second test re-asserts the eval-free property.
- The context schema validator is **not** precompiled. It runs only inside the Node services,
  where there is no CSP and therefore nothing to gain.
- The CSP itself is injected into `index.html` at build time by a Vite plugin, because the dev
  server genuinely needs inline scripts for React Refresh. Shipping a policy that holds in
  production is worth more than having dev and production match.

## Consequences

### Positive

- The shell runs under a strict CSP with no `'unsafe-eval'`. An injected payload has no
  general-purpose route to execution, which is the property the product is built on.
- Validation is faster: no compilation on startup.
- The eval-free assertion is enforced mechanically rather than by review.
- The renderer keeps its own validation, so whole-document rejection still happens at the last
  possible moment.

### Negative

- A 140 kB generated file is committed. It is large, and it is noise in diffs when the schema
  changes.
- One more build step, and a way for a contributor to be confused if they edit the schema and
  forget to regenerate. The staleness test converts that confusion into a clear failure.
- The `require`-to-import normalization is coupled to AJV's output shape. If a future release
  changes it, the generator's assertion fails loudly rather than producing broken output.

### Neutral

- Development and production now differ in whether the CSP is present. This is documented in
  `apps/shell/index.html` and in the Vite plugin.

## Alternatives considered

**Add `'unsafe-eval'` to `script-src`.** Rejected. This is the cheapest fix and the worst one.
SairiOS's headline claim is that an agent cannot execute code in the user's environment;
enabling `eval` for the whole document to save a build step would weaken exactly the control
that claim rests on, and would do so invisibly.

**Drop validation from the renderer and rely on the bridge and the context service.** Rejected.
Those two run in different processes, and the renderer is the last thing standing between a
document and the DOM. Removing the check to avoid a build step trades a real defence for
convenience.

**Hand-write a structural validator for the browser and keep AJV in the services.** Rejected.
Two validators for one schema will drift, and the drift would be silent and security-relevant.

**Use a schema library that compiles without `eval`.** Rejected for v0. Plausible, but it means
changing the validation stack across the whole project for a problem that a build step solves
without touching the schema, the semantics, or the error messages.

**Serve the CSP as an HTTP header instead of a meta tag.** Not an alternative — it changes where
the policy comes from, not whether AJV can call `new Function`. Worth doing later anyway, since
a header can carry directives a meta tag cannot.

## Revisit when

- AJV gains first-class eval-free compilation, or its standalone output no longer needs the
  `require` normalization.
- The generated artefact's size becomes a real cost, for example if the component catalog grows
  several times over.
- The shell moves to Tauri, where the content security story changes shape and a header-based
  policy becomes the natural choice.
