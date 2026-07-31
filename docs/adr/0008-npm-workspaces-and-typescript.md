# 0008. npm workspaces and TypeScript, Rust where it earns it

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

SairiOS is a monorepo: four shared packages, three services and a desktop shell, with
schemas and types shared across all of them. It needs a language, a workspace tool, a
desktop packaging story and a persistence primitive, and the choices interact.

Two constraints dominate.

The first is the contributor on-ramp. An operating environment is already a large thing to
walk into. Every prerequisite added before a contributor can run `make setup` and see
something work is a filter, and the project cannot afford many filters. "Install Node 22,
clone, run setup" is close to the floor. Every step past that costs contributors.

The second is that a native build step is a recurring tax rather than a one-time cost.
Anything requiring compilation at install time means a working toolchain on every
contributor machine, on every CI runner and inside the image build, across two
architectures (ADR 0002). It is the single most common reason a clone fails to build, and
the failures are opaque.

There is also a temptation to name. Rust is the expected answer for anything with the word
"OS" attached, and the expectation is social rather than technical. This ADR names it so
the decision is made on merit and not on impression.

## Decision

### Language and workspaces

SairiOS uses **TypeScript in strict mode** with **project references** across the
monorepo, managed with **npm workspaces**.

Strict mode is on everywhere and is not relaxed per package. Project references give real
build ordering and incremental builds, and they make the package graph explicit rather than
implied by imports.

The Node target is **22 LTS**, with `>=22.5.0` required.

### Rust

Rust is used **only where it earns an OS-level or security-level advantage**, and never for
prestige. Candidate cases, none of which apply in v0: a sandbox supervisor that must
enforce a boundary in a process the rest of the system cannot influence, a hot path where
measured latency is a product problem, a component that must run without a Node runtime, or
work that has to be small and auditable line by line.

"Rust would be more appropriate for an OS project" is not a reason. A rewrite for its own
sake is not a reason. If a Rust component is proposed, the proposal states which advantage
it buys and how that advantage will be measured.

### Desktop packaging

The v0 shell is **React running in the browser**, served on `SAIRIOS_SHELL_PORT` (7800).
In the SairiOS image it is presented full-screen in the graphical session, so the user does
not experience it as a browser.

**Tauri is deferred, behind a documented path.** The path is: keep the shell a standard web
application with no dependence on a specific host runtime, keep all privileged operations
behind the permission broker's HTTP API (ADR 0006) rather than behind host-specific
bridges, and keep the SairiUI renderer (ADR 0003) free of browser-only assumptions. If
those hold, adopting Tauri is a packaging change rather than a rewrite.

**Electron is rejected.**

### Persistence

**`node:sqlite`** is the persistence primitive, with a **JSON store fallback**, selected by
`SAIRIOS_STORE_DRIVER` (`auto` | `sqlite` | `json`). `auto` uses SQLite when the runtime
provides it and falls back to JSON otherwise.

The point is that **there is no native build step**. `node:sqlite` is in the Node standard
library, so SQLite arrives with the runtime. The JSON fallback means that even where SQLite
is unavailable, the system runs.

### Dependency minimalism

The services use the **Node standard library** rather than an HTTP framework. `node:http`
serves the routes; there is no Express, Fastify or Koa. The route surface is small and
mostly machine-to-machine on loopback, and a framework would add a dependency tree, a
release cadence and a security surface in exchange for routing sugar that is a few dozen
lines to write directly.

This is a posture, not a prohibition. Dependencies that do genuinely hard things
(JSON Schema validation, the frontend framework, the test runner) are welcome. What is
avoided is dependencies that wrap something the standard library already does.

## Consequences

### Positive

- One language across schemas, services, shell and tests. A type defined in
  `@sairios/context-schema` is the same type everywhere, checked at build time.
- Prerequisites are Node 22 and git. `npm` ships with Node, so the workspace tool is not a
  separate install.
- No native compilation anywhere, so `npm install` does not need a C toolchain on any
  machine or in the image, on either architecture.
- Project references give incremental builds and enforce the dependency graph, so a
  layering violation is a compile error.
- The dependency tree stays small enough to audit, which matters for a project whose whole
  argument is about trust boundaries.
- A shallow dependency tree means fewer transitive advisories and less upgrade churn.
- The JSON store makes the system runnable in constrained environments with no code changes.

### Negative

- TypeScript is not the fastest option and is not memory-frugal. Node is a substantial
  runtime to have resident in an operating environment.
- Writing HTTP handling against `node:http` means writing routing, body parsing and error
  handling by hand, and hand-written versions of common things carry their own bugs.
- Two store drivers means two implementations and two sets of behavior to keep aligned. The
  JSON store will not match SQLite's transactional semantics under concurrency, and that
  difference has to be understood rather than assumed away.
- `node:sqlite` is newer than the alternatives and its API surface may still shift. Pinning
  to Node 22.5 or later is a real floor that excludes older distributions.
- Browser-hosted shell means no native menus, no native window chrome and no OS-level
  integration until Tauri lands.
- Declining Rust will be read by some as insufficiently serious for an OS project, and that
  perception has a cost even when the reasoning is right.

### Neutral

- vitest, eslint 9 and prettier are the test and quality tooling, configured once at the
  root.
- Project references require every package to emit declarations and have a `tsconfig.json`,
  which is boilerplate but keeps the graph honest.
- Nothing here prevents adding a Rust component later. The decision is about the default,
  not about a ban.
- The Tauri path is deliberately documented as a path rather than a plan with a date.

## Alternatives considered

**pnpm.** Faster installs, strict node_modules layout, better monorepo ergonomics.
Rejected because: as the project default this is a close call, and it is decided on one
fact. pnpm is a good tool. `npm` ships with Node, so choosing it removes a prerequisite
entirely, and the project has decided to spend its prerequisite budget elsewhere. pnpm's
advantages are real (disk usage, install speed, phantom-dependency prevention) and would
matter more at a larger package count. At eight workspaces they do not outweigh one fewer
thing to install. A contributor who prefers pnpm locally is not stopped by anything here.

**Electron for the desktop shell.** The default choice for web-technology desktop apps.
Rejected because: it ships a second full browser engine inside a system that already has
one, with the memory footprint that implies, in an environment where SairiOS is supposed to
be the environment rather than an app inside it. It also enlarges the trust surface, since
the renderer's relationship to Node privileges is exactly the boundary ADR 0003 works to
keep clean.

**better-sqlite3.** Mature, fast, well-documented, the usual choice for SQLite in Node.
Rejected because: it requires native compilation on every contributor machine, every CI
runner and inside the image build, for two architectures. That is a prebuild-matrix problem
and a toolchain prerequisite, and it is the most likely first failure a new contributor
hits. `node:sqlite` gives the same primitive with none of that. If `node:sqlite` proves
inadequate, this is the alternative to revisit first.

**A Rust core with a TypeScript shell.** Write services in Rust from the start.
Rejected because: it doubles the language surface and splits the type definitions that the
schemas exist to unify, in exchange for performance that is not currently a constraint. The
services are I/O-bound coordination code. Nothing in v0 is CPU-limited.

**An HTTP framework (Express or Fastify).** Standard, familiar, well-trodden.
Rejected because: it adds a dependency tree and a release cadence to gain routing
convenience over a small, mostly internal route surface. The standard library covers it. If
the route surface grows substantially, this is worth reopening rather than accumulating a
hand-rolled framework by increments.

## Revisit when

- A measured performance or memory problem is traced to the Node runtime or to TypeScript
  service code, not assumed from first principles. That is the trigger for a Rust
  component, scoped to the specific bottleneck.
- Native desktop integration (menus, tray, file dialogs, window management, deep links)
  becomes a product requirement, which is the trigger to execute the Tauri path.
- The hand-written HTTP layer accumulates enough routing, validation and middleware to be a
  framework in all but name. At that point adopting a real one is a simplification, not an
  addition.
- `node:sqlite` proves unstable, insufficient or slower than the workload needs, which
  reopens `better-sqlite3` and its native build cost with real data behind the trade.
- The workspace count grows enough that npm's install times or hoisting behavior become a
  daily annoyance, which is when pnpm's advantages start to outweigh the extra prerequisite.
- The JSON fallback and SQLite drivers diverge in behavior in a way that produces bugs
  visible to users, which would argue for dropping one.
