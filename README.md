# SairiOS

An experimental operating environment for the age of AI agents.

Traditional operating systems organize interaction around applications, files
and fixed graphical interfaces. SairiOS organizes interaction around
**contexts**.

> **Every window is a context.**
> **Applications are crystallized contexts.**

**Status: milestone 0, a working vertical slice.** The desktop, the context
runtime, the adaptive UI protocol and the permission broker run and are tested.
The VM image has never been booted and the OpenClaw integration is unverified
scaffolding. Both are marked as such throughout, and in [ROADMAP.md](ROADMAP.md).

---

## What a context is

A context is a human intention plus everything that intention accumulates:
memory, conversation, files, tools, agents, permissions, objectives, tasks, UI
state, execution history, and local or remote resources.

"Research AI regulation" is a context. So is "prepare this week's radio column",
"compare three vendor proposals", "manage the SairiOS project", "organize the
trip".

### Three kinds

| Type             | Lifespan       | Examples                                                             |
| ---------------- | -------------- | -------------------------------------------------------------------- |
| **Ephemeral**    | A bounded task | Summarize this document. Compare three budgets. Resize these images. |
| **Persistent**   | Days to months | A software project. An investigation. A company.                     |
| **Crystallized** | Reusable       | Weekly radio production. A release checklist. A research briefing.   |

An ephemeral context archives itself when it completes. A persistent context
keeps its memory, files, permissions and state. A crystallized context is a
workflow that has stabilized enough to run again — which is what SairiOS has
instead of applications.

**Crystallization is a sanitizing operation.** A template keeps the layout, the
component choices, the workflow stages, the permission defaults, the reusable
instructions and the named inputs. It does not keep the conversation, the files,
the secrets or the execution log. You see exactly what will and will not be
carried over before you confirm.

## What SairiOS is not

- **Not a kernel, and not a kernel fork.** It is a Linux-based operating
  _environment_. Linux already solves boot, hardware, processes, networking,
  filesystems, drivers, users, permissions and the graphical session, and none
  of those are where the interesting problem is. See
  [ADR 0001](docs/adr/0001-linux-distribution-not-kernel-fork.md).
- **Not a chatbot with a desktop around it.** There is no message list. The
  agent produces an _interface_ and an activity log, not a transcript.
- **Not a system that lets a model run code on your machine.** The model returns
  a declarative description validated against a fixed component catalog, and
  every privileged action goes through a permission broker.
- **Not production software.** It is an experiment. Do not run it on a machine
  holding data you cannot afford to lose.

---

## Quick start

Requires **Node.js 22.5 or newer** and npm. Nothing else. No API key, no Docker,
no QEMU.

```bash
make setup
```

```bash
make dev
```

Then open **http://127.0.0.1:7800**.

`make dev` runs in **mock mode**: a deterministic offline agent provider with no
credentials and no network access. Three demo contexts are seeded on first run,
one of each type.

To check what your machine can do first:

```bash
make doctor
```

### The demo path

From the context map you can walk the whole thesis:

1. Type an intention and choose ephemeral or persistent.
2. A context is created and the intention goes to the agent through the bridge.
3. The agent returns a **SairiUI** document, which is validated and rendered as
   native-looking widgets.
4. It asks for a capability. Inspect the request, then allow once, allow for this
   context, deny, or deny and remember.
5. The action executes inside that context's sandbox and is written to the audit
   log.
6. Restart the shell. The context is still there, with its interface.
7. Crystallize it. Review what is retained and what is removed, confirm, and run
   the template again as a fresh context.

## Commands

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `make setup`            | Install dependencies, create `.env`, run doctor       |
| `make dev`              | Shell and services in mock mode                       |
| `make doctor`           | Report what this machine can and cannot run           |
| `make test`             | Full test suite                                       |
| `make lint`             | Lint every workspace                                  |
| `make typecheck`        | Type-check every workspace                            |
| `make build`            | Build every workspace                                 |
| `make validate`         | format-check + lint + typecheck + test + build        |
| `make vm-image-dry-run` | Print every step of the image build, touching nothing |
| `make vm-image`         | Build the VM image (downloads a Debian cloud image)   |
| `make vm-run`           | Boot the VM with a graphical display                  |
| `make vm-run-headless`  | Boot the VM headless for a smoke test                 |
| `make clean`            | Remove build output                                   |

Ports, all bound to loopback: shell `7800`, context service `7801`, agent bridge
`7802`, permission broker `7803`.

---

## Architecture

```
┌──────────────────────────────────────────┐
│           SairiOS Desktop Shell          │
├──────────────────────────────────────────┤
│       Adaptive UI / Context Renderer     │
├──────────────────────────────────────────┤
│ Context Service · Memory · Permissions   │
├──────────────────────────────────────────┤
│       OpenClaw Gateway and Runtime       │
├──────────────────────────────────────────┤
│   Linux · systemd · Wayland · PipeWire   │
└──────────────────────────────────────────┘
```

Four processes, each with one job. The shell renders and holds no domain logic.
The context service owns the lifecycle and persistence. The agent bridge
normalizes whichever agent runtime is configured. The permission broker decides
and executes privileged actions.

Full detail in [ARCHITECTURE.md](ARCHITECTURE.md). Decisions with real
alternatives are recorded in [docs/adr/](docs/adr/).

### The adaptive UI protocol

The model **never returns executable frontend code**. It returns a **SairiUI**
document: versioned JSON drawn from an audited catalog of sixteen components,
validated against a JSON Schema before anything is rendered.

```json
{
  "version": "0.1",
  "contextId": "ctx_...",
  "title": "Research AI regulation",
  "contextType": "ephemeral",
  "layout": {
    "type": "workspace",
    "regions": [
      {
        "id": "sources",
        "width": "one-third",
        "component": {
          "type": "source-list",
          "props": { "title": "Sources" },
          "binding": "research.sources"
        }
      }
    ]
  },
  "suggestedActions": []
}
```

The catalog: `text`, `markdown`, `source-list`, `key-value-list`, `editor`,
`table`, `checklist`, `timeline`, `progress`, `status-panel`,
`permission-request`, `action-button`, `terminal-output`, `file-list`,
`context-metadata`, `activity-log`.

Unknown component types and undeclared props are rejected. Rejection is
**whole-document**: a valid region does not rescue an invalid document, because
a partial render would let an attacker get a foothold on screen by making one
region well-formed. A rejected document produces a safe error state that says so.

Worked examples, including two that are invalid on purpose, are in
[examples/](examples/) — and they are covered by tests, so they cannot drift.

### The permission model

The broker separates **observation**, **proposal** and **execution**. The agent
can observe and propose. Only a user decision executes.

| Capability             | Default  | What v0 actually does                       |
| ---------------------- | -------- | ------------------------------------------- |
| `files.read`           | ask      | real, sandbox only                          |
| `files.write`          | ask      | real, sandbox only                          |
| `files.delete`         | **deny** | real, sandbox only, non-recursive           |
| `process.list`         | allow    | SairiOS services only, never host processes |
| `process.execute`      | **deny** | not implemented — there is no shell         |
| `network.fetch`        | ask      | simulated                                   |
| `browser.open`         | ask      | simulated                                   |
| `clipboard.read`       | **deny** | simulated                                   |
| `clipboard.write`      | ask      | simulated                                   |
| `notifications.send`   | ask      | simulated                                   |
| `system.settings.read` | allow    | SairiOS settings only, no secrets           |

Grant scopes: allow once, allow for this context, deny, deny and remember. Every
privileged action is schema-validated, logged, attributable to a context,
visible to you, and cancellable until it runs. Actions that really happen are
confined to the context's sandbox directory; the rest are simulated and labelled
as such in the UI.

## Configuring a model

**SairiOS never authenticates to a model provider.** It holds no provider API
key and makes no provider call. Credentials belong to OpenClaw's own
configuration.

```bash
SAIRIOS_AGENT_PROVIDER=mock       # default: offline, deterministic, no credentials
SAIRIOS_AGENT_PROVIDER=openclaw   # connect to a local OpenClaw Gateway
```

Two setup paths — interactive OpenClaw onboarding, or environment-based local
development — are documented in [docs/OPENCLAW.md](docs/OPENCLAW.md). Startup
checks explain clearly when no provider is configured, and the desktop still
launches in mock mode.

> **The OpenClaw provider is scaffolding.** Its connection lifecycle is
> implemented and unit-tested against a fake transport. Its wire protocol has
> never been run against a live gateway. When the gateway is unreachable it
> reports an error; it never falls back to fabricated output.

## Development with Docker

```
Docker = service development and tool sandboxing
QEMU   = full SairiOS integration testing
```

Docker is **not** how SairiOS is run as an operating system.
[containers/compose.yaml](containers/compose.yaml) runs the three services and a
tool sandbox with capabilities dropped, non-root users, read-only filesystems
and resource limits. See [docs/DOCKER.md](docs/DOCKER.md).

These files have never been built. See the verification note in
[containers/README.md](containers/README.md).

## Testing with QEMU

The VM is the canonical way to test SairiOS as an operating environment: a
Debian 12 cloud image provisioned by cloud-init, with the shell running
fullscreen in `cage` (a minimal kiosk Wayland compositor) via `cog`.

```bash
make vm-image-dry-run   # print every step and every byte it would download
make vm-image           # build it
make vm-run             # boot it
```

> **The image builds and boots.** Verified on macOS arm64 with QEMU 11.0.3:
> Debian 12 comes up, cloud-init provisions, and the guest runs its own
> first-boot self-check and reports over the serial console —
> `ok: 18  warn: 6  fail: 0`, verdict `DEGRADED`, which is the correct pass for
> an image with no product tree delivered yet. The remaining warnings are all
> "no product tree".
>
> The whole stack runs in the guest, and the desktop is reachable from the host
> through an SSH tunnel — guest shell, guest services, guest SQLite, real
> contexts.
>
> The kiosk session cannot present on macOS QEMU: `cage` starts and `cog` loads
> the shell successfully, but Homebrew's QEMU has no virglrenderer, so the guest
> has no working GL and both presentation paths fail on the software fallback.
> [vm/README.md](vm/README.md) has the full trace and the ways round it.

---

## Known limitations

- The VM image is unbuilt and unbooted.
- The OpenClaw integration is unverified scaffolding.
- The Docker files have never been built.
- Most capabilities are **simulated** in v0. Only sandboxed file operations and
  reading SairiOS's own settings do something real.
- The sandbox is path containment plus policy, **not** a strong isolation
  boundary. Container and microVM isolation is milestone 3.
- The services have **no authentication**. They must never be exposed beyond
  loopback.
- No voice input. No real network fetching. No cloud sync.
- `node:sqlite` is an experimental Node API; a JSON store is used as a fallback.

The full list, with the reasoning, is in [SECURITY.md](SECURITY.md).

## Security model

SairiOS assumes model output is untrusted, that retrieved web content carries
prompt injection, and that context files may be malicious. Three trust
boundaries follow from that: SairiUI schema validation, the permission broker,
and sandbox path containment.

Read [SECURITY.md](SECURITY.md) before running this against anything you care
about. It documents the boundaries and, in equal detail, what they do not yet
cover.

To report a vulnerability, use GitHub's private vulnerability reporting rather
than a public issue.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the monorepo layout, and the
gate every change must pass:

```bash
make validate
```

Four invariants a change must not break: contexts stay the primary abstraction,
the UI protocol stays declarative and validated, mock mode keeps working without
credentials, and privileged actions keep going through the broker.

If you use Claude Code in this repository, [CLAUDE.md](CLAUDE.md) is loaded
automatically and encodes the same rules.

## License

[Apache-2.0](LICENSE).
