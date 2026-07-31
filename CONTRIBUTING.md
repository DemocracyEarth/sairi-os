# Contributing to SairiOS

Thanks for working on SairiOS. This document describes what you need installed, how to run
the project, what has to pass before you open a pull request, and the small number of design
invariants a pull request must not break.

SairiOS is an experimental operating environment built around contexts. A context is a human
intention plus its memory, files, tools, agents, permissions, tasks, events and UI state.
Every window is a context. Applications are crystallized contexts. Keep that model in mind
when you propose changes; most review comments trace back to it.

## Prerequisites

Required for all work:

- Node.js 22.5.0 or newer. The stores use `node:sqlite`, which is only available from 22.5.
  Check with `node --version`.
- npm 10 or newer. This repo uses npm workspaces, not pnpm and not yarn. Do not add a
  `pnpm-workspace.yaml` or a `yarn.lock`.
- git.

Optional, and only for specific areas:

- QEMU. Needed only for the VM image work (`make vm-image`, `make vm-run`,
  `make vm-run-headless`, `make vm-clean`). You do not need QEMU to work on the packages,
  the services or the shell.
- Docker. Needed only if you want to run the services in containers. The default developer
  loop runs the services directly on the host and does not use Docker.

If you are unsure whether your machine is set up correctly, run `make doctor`. It reports the
Node version, the ports it expects to be free, and which optional tools it can find.

## Getting started

```sh
make setup   # install workspace dependencies and prepare ./var
make dev     # start context-service, agent-bridge, permission-broker and the shell
```

`make dev` runs in mock agent mode by default (`SAIRIOS_AGENT_PROVIDER=mock`). Mock mode needs
no API key, no network access and no OpenClaw gateway. If your first run asks you for a
credential, that is a bug worth reporting.

Copy `.env.example` to `.env` if you want to change ports, the data directory, the sandbox
directory or the log level. Never commit a `.env` file and never put a real key, token or
gateway secret in any file in this repository.

Default local ports:

| Service           | Port |
| ----------------- | ---- |
| shell             | 7800 |
| context-service   | 7801 |
| agent-bridge      | 7802 |
| permission-broker | 7803 |

Everything binds to `127.0.0.1` by default (`SAIRIOS_BIND_HOST`). Do not change that default
to `0.0.0.0` in a pull request without an explicit discussion; these services are not
hardened for exposure on a network.

## Monorepo layout

| Path                          | Package name                  | What lives there                                                          |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `packages/shared`             | `@sairios/shared`             | Cross-cutting types, config loading, logging, small utilities.            |
| `packages/context-schema`     | `@sairios/context-schema`     | The context model: types, JSON Schema, lifecycle, crystallization.        |
| `packages/adaptive-ui-schema` | `@sairios/adaptive-ui-schema` | The SairiUI protocol: types, JSON Schema, component catalog, validator.   |
| `packages/ui-components`      | `@sairios/ui-components`      | The React renderer for the audited SairiUI catalog.                       |
| `services/context-service`    | `@sairios/context-service`    | HTTP service that owns context persistence and queries.                   |
| `services/agent-bridge`       | `@sairios/agent-bridge`       | HTTP and WebSocket bridge to the agent provider (mock or OpenClaw).       |
| `services/permission-broker`  | `@sairios/permission-broker`  | Capability policy, prompts, grants and the observe/propose/execute split. |
| `apps/shell`                  | `@sairios/shell`              | The Vite and React shell: windows, context switching, SairiUI rendering.  |

TypeScript project references connect these. If you add a cross-package import, add the
matching reference in the consuming package's `tsconfig.json`, otherwise `make typecheck`
will fail in a way that is hard to read.

## The validation gate

Run all four locally before you open a pull request. CI runs exactly the same four commands,
so a green local run is a good predictor of a green CI run.

```sh
make lint        # eslint 9 across the workspace
make typecheck   # tsc --build, strict, project references
make test        # vitest run
make build       # every workspace's build script
```

Two notes:

- `make test` must pass with no API key present and no network access. If your test needs a
  live model or a live gateway, it belongs behind an explicit opt-in and must be skipped by
  default.
- Formatting is enforced by prettier. Run `npm run format` before committing, or
  `npm run format:check` to see what would change.

## Commits and pull requests

- Small, coherent commits. One concern per commit. A commit that renames a symbol and also
  changes behavior is two commits.
- Imperative mood in the subject line: "add sandbox path check", not "added" or "adds".
- Keep the subject under about 72 characters. Put the reasoning in the body. Reviewers care
  much more about why than about what.
- Do not mix a dependency bump with a feature change.
- Pull request descriptions should state what changed, why, how you tested it, and which of
  the invariants below you considered.

If something in your change could not be executed or verified on your machine (for example,
the QEMU targets on a host without QEMU), say so plainly in the pull request. Do not describe
unverified work as verified.

## The four invariants

A pull request must not break any of these. If you believe one of them is wrong, open an
issue and argue the case before writing the code; do not erode it incidentally.

**(a) Contexts stay the primary abstraction.** Everything a user does happens inside a
context: ephemeral (a bounded task), persistent (a long-lived workspace), or crystallized (a
stabilized reusable workflow). Do not introduce a parallel top-level concept such as an app
registry, a document model or a session object that owns state contexts should own. The
moment state escapes the context model, memory, permissions and history stop lining up, and
the product stops being coherent.

**(b) The UI protocol stays declarative and schema-validated.** The model returns SairiUI
JSON, never executable frontend code. Every payload is validated against the versioned JSON
Schema and the audited 16-component catalog before it renders. Unknown component types and
unknown props reject the whole document and a safe error state renders instead. Do not add an
escape hatch: no raw HTML prop, no inline style string passthrough, no `dangerouslySetInnerHTML`,
no client-side eval of model output. This validation boundary is the main thing standing
between untrusted model output and the user's machine.

**(c) Mock mode keeps working with no credentials.** With `SAIRIOS_AGENT_PROVIDER=mock`, a
fresh clone must set up, build, test and run offline with no API key. This is how new
contributors get started, how CI runs, and how anyone reproduces a bug without paying for
tokens. If a change makes the app require a credential to boot, the change is wrong.

**(d) Privileged actions keep going through the permission broker.** All 11 capabilities
(`files.read`, `files.write`, `files.delete`, `process.list`, `process.execute`,
`network.fetch`, `browser.open`, `clipboard.read`, `clipboard.write`, `notifications.send`,
`system.settings.read`) are mediated by the broker, with `allow`, `ask` or `deny` policies and
grant scopes of allow once, allow for this context, deny, or deny and remember. There is no
unrestricted shell execution from the model. Agent file actions stay confined to
`SAIRIOS_SANDBOX_DIR` (default `./var/sandbox`). Do not add a direct filesystem, process or
network call from the agent path that skips the broker, and do not widen a default policy
without a written justification. The broker is the only place a user can see and revoke what
the system is allowed to do on their behalf.

## Adding a SairiUI component

Treat this as a security review, not as a UI change. Each component in the catalog is a new
place where model-produced content reaches the screen, so the review question is not "does it
look right" but "what can an adversarial payload do with it".

Work through all of these in one pull request:

1. **Types.** Add the component's prop types in `packages/adaptive-ui-schema/src/types.ts`.
   Props must be closed: no index signatures, no `unknown` passthrough, no `Record<string, any>`.
2. **JSON Schema.** Add the matching definition in
   `packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json`, with
   `"additionalProperties": false`, explicit types, and bounds on anything unbounded (string
   lengths, array lengths, enum values). Bump the protocol version if the change is not
   backward compatible.
3. **Catalog entry.** Register the component in `packages/adaptive-ui-schema/src/catalog.ts`.
   The catalog is the audited list; a component that is not in it must not render.
4. **Renderer.** Implement the component in `packages/ui-components`. It must render only from
   validated props, must not accept raw HTML, must not build URLs or event handlers by string
   concatenation from model input, and must not reach outside the component to touch global
   state.
5. **Tests.** Cover the happy path, at least one rejection case (unknown prop, wrong type,
   out-of-bounds value) proving the whole document is rejected, and the safe error state.
6. **Write the justification in the pull request description.** Name the new content source
   the component introduces (text, a URL, an image reference, a numeric value, a user action)
   and say why it is safe: what validates it, what bounds it, what it cannot reach. A pull
   request that adds a component without this paragraph will be sent back.

If the component needs a capability at render time, that capability goes through the
permission broker like any other. Rendering must never be the thing that grants access.

## Dependency policy

Runtime dependencies are the ones that ship. Every new runtime dependency needs a
justification in the pull request description covering:

- what problem it solves and why the standard library or existing dependencies cannot,
- its transitive dependency count and install size,
- its license (must be compatible with Apache-2.0),
- its maintenance status and release cadence.

Prefer no dependency. Prefer a small, well-maintained one over a large one. Prefer moving the
code into `packages/shared` when the need is a few dozen lines.

Development dependencies get a lighter review, but the same questions apply if they are large
or introduce a build step.

OpenClaw is an upstream pinned dependency reached through `services/agent-bridge`. Do not
vendor its source into this repository. Change the pin (`OPENCLAW_VERSION`) in its own commit,
with the upstream changelog referenced in the message.

## Reporting security issues

Do not open a public issue for a security vulnerability, and do not describe one in a pull
request. See `SECURITY.md` for the reporting process and the supported versions. That file is
the single source of truth; this document deliberately does not repeat it.

## Licensing and sign-off

SairiOS is licensed under the Apache License 2.0. By contributing, you agree that your
contributions are licensed under the same terms. See `LICENSE`.

We use the Developer Certificate of Origin (DCO, https://developercertificate.org). Sign off
every commit:

```sh
git commit -s -m "add sandbox path check"
```

That adds a trailer to the commit message:

```
Signed-off-by: Your Name <you@example.com>
```

The sign-off is your statement that you wrote the contribution, or otherwise have the right to
submit it under Apache-2.0. If you forget it on the last commit, `git commit --amend -s` fixes
it; for a longer branch, `git rebase --signoff` over the range works.

Participation in this project is governed by `CODE_OF_CONDUCT.md`.
