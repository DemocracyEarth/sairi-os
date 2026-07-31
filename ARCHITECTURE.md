# SairiOS architecture

This document describes how SairiOS is put together and, where it matters, why.
Decisions with alternatives worth recording live in [docs/adr/](docs/adr/).

## The idea in one paragraph

Traditional operating systems organize interaction around applications, files
and fixed graphical interfaces. SairiOS organizes interaction around
**contexts**: a human intention plus everything that intention accumulates —
memory, files, tools, agents, permissions, objectives, tasks, UI state and
execution history. **Every window is a context.** A context that stabilizes into
a repeatable workflow can be **crystallized** into a reusable template, which is
what SairiOS has instead of applications.

## Layers

```
┌──────────────────────────────────────────┐
│           SairiOS Desktop Shell          │   apps/shell
├──────────────────────────────────────────┤
│       Adaptive UI / Context Renderer     │   packages/ui-components
├──────────────────────────────────────────┤   packages/adaptive-ui-schema
│ Context Service · Memory · Permissions   │   services/context-service
├──────────────────────────────────────────┤   services/permission-broker
│       OpenClaw Gateway and Runtime       │   services/agent-bridge
├──────────────────────────────────────────┤
│   Linux · systemd · Wayland · PipeWire   │   os/ · vm/
└──────────────────────────────────────────┘
```

SairiOS is not a kernel. Linux supplies boot, hardware support, processes,
networking, filesystems, drivers, users, permissions, services and the graphical
session. The novel surface is contexts, not scheduling
([ADR 0001](docs/adr/0001-linux-distribution-not-kernel-fork.md)).

## Repository layout

```
apps/shell/                    Desktop shell (TypeScript, React, Vite)
packages/shared/               IDs, logging with redaction, Result, env, cloud interfaces
packages/context-schema/       Context domain model, lifecycle, crystallization, JSON Schema
packages/adaptive-ui-schema/   SairiUI protocol: types, component catalog, JSON Schema
packages/ui-components/        The renderer and the sixteen catalog components
services/context-service/      Context persistence and domain operations   (HTTP :7801)
services/agent-bridge/         Provider abstraction, mock and OpenClaw      (HTTP :7802)
services/permission-broker/    Policy, capability execution, audit log      (HTTP :7803)
openclaw/                      Pinned version, SairiOS skill, agent workspace
os/                            systemd units, Wayland session, branding
vm/                            cloud-init and QEMU image build/run scripts
containers/                    Docker Compose for service development and tool sandboxing
scripts/                       doctor, dev orchestrator, clean
docs/                          Architecture decision records and operational guides
examples/                      Reference SairiUI documents and contexts (tested)
tests/                         End-to-end flow in mock mode
```

## Process boundaries

Four processes in development, each with one job:

| Process           | Port | Responsibility                             | Talks to                          |
| ----------------- | ---- | ------------------------------------------ | --------------------------------- |
| shell             | 7800 | Render contexts. No domain logic.          | all three services                |
| context-service   | 7801 | Own the context lifecycle and persistence. | its store                         |
| agent-bridge      | 7802 | Normalize an agent behind one interface.   | provider, broker, context-service |
| permission-broker | 7803 | Decide and execute privileged actions.     | the sandbox                       |

Two rules hold across all of them:

1. **The shell never talks to a model.** It talks to the bridge, which talks to
   a provider. The shell holds no credentials and knows no provider protocol.
2. **The bridge cannot grant a permission.** It can only propose. Only a user
   decision moves a request to execution.

Everything binds to loopback and has **no authentication**. That is a deliberate
v0 posture, not an oversight: adding a token would imply a security property
this boundary does not have. See [SECURITY.md](SECURITY.md).

## Trust boundaries

Three, described in full in [SECURITY.md](SECURITY.md):

1. **SairiUI schema validation** — between model output and the screen. The
   model never returns executable code; it returns a declarative document
   validated against a sixteen-component catalog. Rejection is whole-document.
2. **The permission broker** — between a proposed action and a real one.
   Observation, proposal and execution are separate phases.
3. **Sandbox path containment** — between agent-supplied paths and the
   filesystem. One module, symlink-aware, no absolute paths, no traversal.

## Data flow: an intention becomes an interface

```
user types an intention
        │
        ▼
  shell ──POST /contexts──────────────▶ context-service
        │                               creates a draft context
        │◀──────────────────────────────
        │
        ├──POST /contexts/:id/intention▶ context-service
        │                               draft → active (state machine)
        │
        └──POST /intentions────────────▶ agent-bridge
                                              │
                                              ├─▶ provider (mock | openclaw)
                                              │
                            tool call ◀───────┤
                                  │           │
                POST /requests    ▼           │
        permission-broker ◀───────┘           │
             records a PROPOSAL               │
             (nothing executes)               │
                                              │
                       SairiUI document ◀─────┤
                                  │           │
                          validate            │
                                  │           │
                PUT /contexts/:id/ui          │
                context-service               │
                validates AGAIN and persists  │
                                              │
  shell ◀──── NDJSON event stream ────────────┘
        │
        ├─ renders the document (validates a THIRD time in the renderer)
        └─ shows the pending permission with four options

user chooses
        │
        ├──POST /requests/:id/decision─▶ permission-broker   (decision recorded)
        └──POST /requests/:id/execute──▶ permission-broker   (policy re-checked,
                                                              action runs in the
                                                              context sandbox,
                                                              result audited)
```

The document is validated three times, in three processes. That is not
redundancy by accident: each process makes its own trust decision about input
arriving from another.

## Context lifecycle

```
                 ┌──────────┐
                 │  draft   │  an intention, not yet running
                 └────┬─────┘
                      │
        ┌─────────────▼──────────────┐
        │           active           │◀──────────┐
        └──┬────────┬────────┬───────┘           │
           │        │        │                   │
     ┌─────▼──┐  ┌──▼─────┐  │              ┌────┴─────┐
     │waiting │  │ failed │  │              │ archived │
     └──┬─────┘  └──┬─────┘  │              └────▲─────┘
        │           │        │                   │
        └───────────┴────────▼───────────────────┘
                      ┌───────────┐
                      │ completed │
                      └───────────┘
```

- `waiting` almost always means a pending permission decision.
- Completing an **ephemeral** context archives it automatically, so the context
  map does not silently fill with finished work.
- Archiving destroys nothing. Every status can reach `archived`, and `archived`
  can return to `active`. There is a test asserting both.
- All of this lives in one state machine
  ([packages/context-schema/src/lifecycle.ts](packages/context-schema/src/lifecycle.ts)).
  UI components ask it whether a transition is legal; they never encode the
  rules ([ADR 0005](docs/adr/0005-contexts-as-primary-abstraction.md)).

## Crystallization

Crystallization is a **sanitizing** operation, not a copy. The sanitizer is
allow-list based, so anything added to the context model later is dropped by
default — the safe direction for a document the user intends to reuse and
possibly share.

| Retained                                              | Removed                                     |
| ----------------------------------------------------- | ------------------------------------------- |
| Layout and region structure                           | Conversation content                        |
| Component choices and structural props                | Table rows, notes, sources, fetched content |
| Workflow stages (including approval steps)            | Files and artifacts                         |
| Permission defaults, with `allow` downgraded to `ask` | Grants themselves                           |
| Reusable instructions                                 | Secrets and anything sensitive              |
| Named input fields                                    | Non-durable memory scopes                   |
| Durable, non-sensitive memory                         | The agent session, the execution log        |

Two details worth knowing:

- A remembered `allow` becomes `ask` in the template. A template must never
  pre-authorize a capability in a new context with new data.
- `permission-request` regions are dropped entirely rather than carried forward,
  because their request id refers to the original context.

The user sees a preview of exactly this, item by item with reasons, before
confirming.

## The SairiUI protocol

Versioned declarative JSON. Full schema:
[packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json](packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json).
Worked examples, valid and rejected: [examples/](examples/).

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
          "props": { "title": "Sources", "sources": [] },
          "binding": "research.sources"
        }
      }
    ]
  },
  "suggestedActions": []
}
```

The v0 catalog, with where each component's content comes from:

| Component                                                  | Content source                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `text`, `markdown`, `source-list`, `key-value-list`        | model                                                        |
| `editor`, `table`, `checklist`, `timeline`                 | model                                                        |
| `progress`, `status-panel`, `terminal-output`, `file-list` | model                                                        |
| `action-button`                                            | model (opaque action id; execution still needs a capability) |
| `permission-request`                                       | **broker** — cross-checked, never model-supplied             |
| `context-metadata`, `activity-log`                         | **host** — read from SairiOS state                           |

Adding a component is a security review, not a UI change: it widens what an
agent can put on a user's screen. See [CONTRIBUTING.md](CONTRIBUTING.md).

The validator that runs in the shell is **precompiled** into eval-free JavaScript
at build time, because the shell's Content Security Policy forbids the runtime
code generation AJV normally uses. A test regenerates it and fails if it has
drifted from the schema. See
[ADR 0009](docs/adr/0009-precompiled-schema-validator.md).

## OpenClaw integration

OpenClaw is an upstream pinned runtime dependency reached only through the agent
bridge, never vendored ([ADR 0004](docs/adr/0004-openclaw-behind-agent-bridge.md)).

```
shell ──HTTP──▶ agent-bridge ──▶ AgentProvider
                                   ├── MockAgentProvider      offline, deterministic, no key
                                   └── OpenClawAgentProvider  ws → local gateway  [SCAFFOLDING]
```

The provider interface is the seam. Two things it guarantees:

- **Mock mode is first class.** Every test runs against it, `make dev` uses it,
  and the VM boots into it. It needs no credentials and makes no network call.
- **A failing OpenClaw never falls back to mock.** A user who selected
  `openclaw` must not be shown fabricated output when the gateway is down.

The wire codec is isolated in one object so reconciling it with a real gateway
touches one function in each direction. It is **unverified** — see
[docs/OPENCLAW.md](docs/OPENCLAW.md).

## Persistence

`ContextStore` has two implementations behind one interface:

- **sqlite** — `node:sqlite`, which ships with Node. No native build step on any
  contributor machine and none in the VM image.
- **json** — a portable single-file store with write-then-rename, used as a
  fallback and by tests.

`auto` prefers SQLite and falls back with a warning rather than failing to
start: persistence must never be the reason SairiOS will not boot.

Everything read back off disk is **re-validated** against the context schema. A
file on disk is outside the trust boundary — it may have been edited, synced or
corrupted since it was written. A row that no longer validates is dropped with a
warning rather than crashing the service.

## VM architecture

```
host ── QEMU ──▶ Debian 12 (bookworm) genericcloud
                  │
                  ├── cloud-init (first boot: user sairi, Node 22, packages)
                  ├── systemd system unit  → sairios-session (cage + cog kiosk)
                  └── systemd user units   → context-service
                                             permission-broker
                                             agent-bridge
                                             shell (vite preview :7800)
```

For v0 the shell runs fullscreen inside `cage`, a minimal kiosk Wayland
compositor, displaying `cog` pointed at `http://127.0.0.1:7800`. **No custom
compositor is written in this milestone.** The kernel is neither modified nor
compiled ([ADR 0002](docs/adr/0002-qemu-for-system-testing.md)).

Docker is for service development and tool sandboxing only. QEMU is the
canonical way to test SairiOS as an operating environment.

> The VM image has never been built or booted: the machine this repository was
> scaffolded on had no QEMU. See [vm/README.md](vm/README.md) for the exact
> verification steps.

## Future cloud synchronization

The seam is designed now; the implementation stays local-only
([ADR 0007](docs/adr/0007-cloud-sync-boundary.md)). Four interfaces in
[packages/shared/src/cloud.ts](packages/shared/src/cloud.ts):

```
ContextSyncProvider      replicate a context between devices
SecretProvider           resolve a secret by NAME, locally
ArtifactStore            store and retrieve context files
RemoteExecutionProvider  run a capability elsewhere, still through the broker
```

One implementation ships: `LocalOnlyContextSyncProvider`.

The load-bearing rule is the separation of **syncable context state** from
**device-local state**. A context must be able to move between a desktop, a
phone, a cloud VM and an autonomous worker. Window geometry, focus and scroll
position must not. And a synchronised document carries secret _names_, never
values — a document containing a raw credential is a bug the provider must
reject.

## Testing

| Layer             | What is covered                                                   |
| ----------------- | ----------------------------------------------------------------- |
| Context lifecycle | every transition, reachability, ephemeral auto-archive            |
| Crystallization   | what survives and, more importantly, what must not                |
| JSON Schema       | both schemas, including hostile payloads                          |
| Permission policy | defaults, resolution precedence, the full three-phase flow        |
| Agent bridge      | mock determinism, broker routing, rogue-provider rejection        |
| UI rendering      | safe error state, whole-document rejection, markdown restrictions |
| End to end        | the complete demo flow against the real HTTP services             |
| Examples          | every reference payload, valid and rejected                       |

No test requires an API key, touches the network, or takes more than a few
seconds. See [CONTRIBUTING.md](CONTRIBUTING.md) for the validation gate.
