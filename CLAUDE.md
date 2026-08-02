# CLAUDE.md

Instructions for Claude Code sessions working in this repository.

Read this before making changes. It records the invariants that make SairiOS
what it is; a change that breaks one of them is a regression even if every test
passes.

## What SairiOS is

An experimental operating environment organized around **contexts** rather than
applications. A context is a human intention plus everything it accumulates:
memory, files, tools, agents, permissions, objectives, tasks, UI state and
execution history.

**Every window is a context. Applications are crystallized contexts.**

Start with [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Invariants

These are not preferences. Breaking one changes what the product is.

### 1. Contexts stay the primary abstraction

Contexts are not a folder metaphor, not a tab bar, and not a chat session list.
Do not add a "documents" view, an "apps" grid, or a global chat panel. Features
attach to a context or they do not exist.

Lifecycle logic lives in exactly one place:
[packages/context-schema/src/lifecycle.ts](packages/context-schema/src/lifecycle.ts).
Do not encode transition rules in a UI component, a service handler or a store.
If you need a new rule, change the state machine and its test.

### 2. Do not turn this into a chatbot

The strongest failure mode for this codebase is drifting toward a chat window
with tool calls. There is no message list in the shell, and there should not be.
The agent's output is an **interface** plus an activity log, not a transcript.

If you find yourself adding chat bubbles, a conversation scroll, or a "type a
message" box inside a context window, stop and reconsider.

### 3. The UI protocol stays declarative

The model returns a **SairiUI document**: JSON drawn from a fixed catalog,
validated before rendering. It never returns HTML, JSX, React, JavaScript or CSS.

Do not add:

- `dangerouslySetInnerHTML` anywhere, for any reason;
- a component whose element type is computed from input;
- an "escape hatch" component that renders arbitrary markup;
- a way to bypass validation "just for trusted providers". There are none.

Adding a catalog component is a **security review**. It requires, together:
schema entry, TypeScript type, catalog metadata recording the content source,
renderer case, and tests including a hostile-payload case. The exhaustive
`switch` in `renderComponent` will fail the build if you add a type without a
renderer — that is intentional.

### 4. Validate all model output

Anything from a model, a gateway, the network, or a file on disk is untrusted
and arrives as `unknown`. It becomes typed only by passing a validator.

The existing triple validation (bridge, context service, renderer) is not
redundancy to clean up. Each is a separate process making its own trust
decision. Leave it.

Rejection is **whole-document**. Never partially render a document that failed
validation.

The shell's validator is precompiled (`scripts/build-validator.mjs`), because
the shell's Content Security Policy forbids the runtime code generation AJV
normally uses. If you change the SairiUI schema, regenerate it:

```bash
npm run build:validator -w @sairios/adaptive-ui-schema
```

Never add `'unsafe-eval'` to the shell's policy to avoid that step. See
[ADR 0009](docs/adr/0009-precompiled-schema-validator.md).

### 5. Preserve the security boundaries

- Every privileged action goes through the permission broker. No exceptions, no
  direct `fs` or `fetch` call on behalf of an agent anywhere else.
- Observation, proposal and execution stay separate. A proposal must never
  execute, even under an `allow` policy.
- Policy is re-checked at execution time. Do not "optimize" that away.
- **Never implement unrestricted shell execution.** `process.execute` is denied
  and unimplemented, and that is the design.
- All agent-supplied paths go through
  [services/permission-broker/src/sandbox.ts](services/permission-broker/src/sandbox.ts).
  Do not build a path from agent input anywhere else.
- Services bind to loopback. Do not change a default to `0.0.0.0`.
- Read [SECURITY.md](SECURITY.md) before touching the broker, the sandbox or a
  schema. Update it when a boundary moves.

### 6. Keep mock mode working

`SAIRIOS_AGENT_PROVIDER=mock` must always run with **no credentials, no network
and no external process**. Every test runs against it, `make dev` uses it, and
the VM boots into it.

A change that makes mock mode need a key, a socket or a running gateway is a
bug. And a failing real provider must never fall back to mock output — a user
who selected `openclaw` must not be shown fabricated results.

### 7. English is the default; Spanish stays supported

English is the default interface language and is listed first everywhere a
language is offered. `DEFAULT_LOCALE` is derived from `LOCALES[0]` in
[packages/ui-components/src/i18n.tsx](packages/ui-components/src/i18n.tsx) —
change the order there, not in a second constant.

SairiOS was originally designed Spanish-first and that was deliberately
reversed. Spanish is still a fully supported second language, not a leftover:
every message key exists in both, the CLI accepts both languages' verbs
regardless of which one the desktop is in, and a stored preference always beats
the default. `i18n.test.tsx` asserts all of that, including placeholder parity
between the dictionaries.

Two mistakes to avoid, both of which have already happened once:

- putting a Spanish literal on a shared code path, so it renders in English too
  (`aria-label="contexto"`, `s.opened('mapa de contextos')`);
- writing one language's word into the other's strings — the English help text
  told people to type `contexto`.

Agent-produced UI text is not translated by anything. See the Language section
of [openclaw/skills/sairios-context/SKILL.md](openclaw/skills/sairios-context/SKILL.md).

### 8. Never commit secrets

No API key, token or credential in source, tests, fixtures, image layers,
Dockerfiles or cloud-init files. `.env` is git-ignored; keep it that way.

Log fields pass through
[packages/shared/src/redact.ts](packages/shared/src/redact.ts). If you add a new
log sink, route it through redaction.

Provider credentials belong to OpenClaw's configuration. SairiOS holds at most a
local gateway token.

## Working practices

### Add tests for domain changes

Any change to the lifecycle, crystallization, permission policy, either schema,
or the sandbox needs tests in the same commit. For security-relevant code, test
what must **not** happen, not only what must.

The crystallization tests are the model to follow: they assert that secrets,
conversation, files and run content do not survive.

### Justify dependencies

The services deliberately use the Node standard library rather than an HTTP
framework, and `ws` exists only for the OpenClaw gateway client. Every runtime
dependency is attack surface in a system that runs untrusted model output.

Before adding one, ask whether twenty lines of standard library would do. If you
add one, say why in the commit message.

### Update the architecture docs when boundaries change

Moving a process boundary, a trust boundary or a data flow means updating
[ARCHITECTURE.md](ARCHITECTURE.md), and [SECURITY.md](SECURITY.md) if the
security posture changed. A significant decision with real alternatives gets an
ADR in [docs/adr/](docs/adr/).

### Make small coherent commits

One concern per commit, imperative mood, a body explaining _why_ when it is not
obvious. Do not mix a refactor with a behaviour change.

Do not commit, push, create a remote, or open a PR unless asked.

### Run validation before claiming completion

```bash
make validate
```

That runs format-check, lint, typecheck, test and build — the same gate CI uses.
Never report work as done without running it, never paraphrase a failure as a
success, and never invent output you did not see.

## Honesty rules

This repository documents its own unverified parts, and that must stay true.

- The VM image has **never been built or booted**. Do not write anything
  claiming it boots until someone has actually done it and said so.
- The OpenClaw provider is **scaffolding**. Its wire protocol is unverified. Do
  not remove the SCAFFOLDING notices until the steps in
  [docs/OPENCLAW.md](docs/OPENCLAW.md) have actually been carried out.
- Docker files have never been built on the authoring machine.
- Most capabilities are **simulated** in v0, and the shell says so. Keep the
  `simulated` flag accurate. A user must always know whether something really
  happened.

If you cannot verify something, write down that you could not, and what would
verify it.

## Commands

```bash
make setup        # install dependencies, create .env
make doctor       # what this machine can and cannot run
make dev          # shell + services in mock mode, no API key
make test         # full test suite
make validate     # format-check + lint + typecheck + test + build
```

Ports: shell 7800, context-service 7801, agent-bridge 7802, permission-broker 7803. All loopback.

## Layout

```
apps/shell/                    Desktop shell. No domain logic.
packages/shared/               IDs, logging+redaction, Result, env, cloud interfaces
packages/context-schema/       Domain model, lifecycle, crystallization, JSON Schema
packages/adaptive-ui-schema/   SairiUI protocol and catalog
packages/ui-components/        Renderer and the sixteen components
services/context-service/      Persistence and domain operations
services/agent-bridge/         Provider abstraction (mock, openclaw)
services/permission-broker/    Policy, execution, audit
os/ vm/ containers/            Privileged OS integration, image build, dev containers
docs/adr/                      Architecture decision records
examples/                      Reference payloads — tested, not decorative
```

## Where to be careful

| File                                                          | Why                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json` | The boundary between model output and the screen                 |
| `services/permission-broker/src/sandbox.ts`                   | The only path-containment implementation                         |
| `services/permission-broker/src/broker.ts`                    | The three-phase separation                                       |
| `packages/context-schema/src/crystallize.ts`                  | Allow-list sanitizer; a leak here escapes with a shared template |
| `packages/context-schema/src/lifecycle.ts`                    | The single source of lifecycle truth                             |
| `packages/ui-components/src/markdown.tsx`                     | Renders untrusted markdown without HTML                          |
| `apps/shell/vite.config.ts`                                   | Injects the production Content Security Policy                   |
