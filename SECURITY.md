# Security

SairiOS gives an AI agent a seat inside an operating environment. That is the
product, and it is also the entire security problem. This document states what
SairiOS assumes, what it enforces, and — just as importantly — what it does not
yet protect against.

## Status of this milestone

**SairiOS v0 is an experimental prototype. Do not run it on a machine holding
data you cannot afford to lose, and do not expose any of its services beyond
loopback.**

Nothing in this document should be read as a claim that v0 is safe to point at
hostile input in production.

## Reporting a vulnerability

Report privately. Do not open a public issue.

- Use GitHub's **Report a vulnerability** button under the repository's Security
  tab (private vulnerability reporting), or
- email `security@sairios.dev` _(placeholder — maintainers must configure a real
  address and a monitored inbox before the first public release)_.

Include the version or commit, what you did, what happened, and what you
expected. A proof of concept helps. We will acknowledge within 5 working days
and aim to give a fix or a plan within 30 days.

Please do not run tests against machines you do not own.

## Threat model

### Assumptions

1. **Model output is untrusted.** A model can be wrong, can be manipulated, and
   can be induced to emit anything an attacker chooses.
2. **Retrieved content carries prompt injection.** Any web page, document or
   file the agent reads may contain text written to hijack it.
3. **Context files may be malicious.** Files in a sandbox may have been placed
   there by an earlier compromised run, or supplied by someone else.
4. **The user is not an adversary**, but the user is busy. Prompt fatigue is a
   real failure mode; a system that asks twenty times a day trains people to
   click "allow".
5. **The local machine is trusted.** SairiOS does not defend against an attacker
   who already has code execution as the user.

### Non-assumptions

- SairiOS does **not** assume the model is aligned, honest or uncompromised.
- SairiOS does **not** assume its own services are safe to expose to a network.
- SairiOS does **not** claim its v0 sandbox resists a determined attacker with
  code execution inside it. See "Known limitations".

## Trust boundaries

```
┌─ untrusted ─────────────────────────────────────────────────────────┐
│  model output · retrieved web content · files in a context sandbox  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │  BOUNDARY 1: SairiUI schema validation
                              │  BOUNDARY 2: permission broker
┌─────────────────────────────▼───────────────────────────────────────┐
│  SairiOS services: context-service, agent-bridge, permission-broker │
│  loopback only, no authentication, must never be exposed            │
└─────────────────────────────┬───────────────────────────────────────┘
                              │  BOUNDARY 3: sandbox path containment
┌─────────────────────────────▼───────────────────────────────────────┐
│  the host: filesystem, processes, network, clipboard                │
└─────────────────────────────────────────────────────────────────────┘
```

### Boundary 1 — the model never returns code

An agent returns a **SairiUI document**: declarative JSON drawn from a fixed
catalog of sixteen components, validated against a JSON Schema with
`additionalProperties: false` before a single node is rendered.

- Unknown component types are rejected **by name**.
- Undeclared props are rejected, which is what stops event handlers, raw HTML
  and `dangerouslySetInnerHTML` from being smuggled through a legitimate
  component.
- Rejection is **whole-document**. A valid region does not rescue an invalid
  document; a partial render would let an attacker get a foothold on screen by
  making one region well-formed.
- Validation happens **twice** — in the agent bridge and again in the renderer —
  because they are separate processes making separate trust decisions.
- The markdown renderer emits React elements from a tiny subset. It never calls
  `dangerouslySetInnerHTML`, never emits an element type derived from input, and
  refuses any link scheme other than `http` and `https`.
- Two components (`context-metadata`, `activity-log`) render SairiOS's own state:
  the model asks for the view, it does not supply the contents.
- `permission-request` is cross-checked against the broker. A request id the
  broker does not recognise renders as an error, never as an approvable prompt.

The alternative — a model returning React or HTML — would make every successful
prompt injection equivalent to code execution in the user's shell. See
[ADR 0003](docs/adr/0003-declarative-adaptive-ui.md).

### Boundary 2 — every privileged action goes through the broker

The permission broker separates **observation**, **proposal** and **execution**:

| Phase       | Who can trigger it | What it does                                               |
| ----------- | ------------------ | ---------------------------------------------------------- |
| Observation | agent, UI          | describes a capability. No side effects.                   |
| Proposal    | agent              | records an intent and resolves policy. **Never executes.** |
| Execution   | user decision only | runs the action.                                           |

Properties that hold by construction:

- A proposal never executes, even under an `allow` policy. An `allow` produces
  an `allowed` request that still needs a separate execute call, so the audit
  trail always contains both steps.
- Policy is re-checked **at execution time**, so a "deny and remember" recorded
  after an approval still blocks the action.
- Every privileged action is schema-validated, logged, attributable to a
  context, visible to the user, and cancellable until it runs.
- The agent has no code path that grants a permission. The bridge can only ask.
- **There is no unrestricted shell.** `process.execute` is denied by default
  _and_ unimplemented: it returns `not_implemented` even if execution is reached.

Default policies:

| Capability             | Default  | v0 behaviour                                                |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `files.read`           | ask      | real, sandbox only                                          |
| `files.write`          | ask      | real, sandbox only                                          |
| `files.delete`         | **deny** | real, sandbox only, non-recursive                           |
| `process.list`         | allow    | SairiOS services only — host processes are never enumerated |
| `process.execute`      | **deny** | not implemented                                             |
| `network.fetch`        | ask      | simulated — no socket is opened                             |
| `browser.open`         | ask      | simulated                                                   |
| `clipboard.read`       | **deny** | simulated                                                   |
| `clipboard.write`      | ask      | simulated                                                   |
| `notifications.send`   | ask      | simulated                                                   |
| `system.settings.read` | allow    | SairiOS settings only, no env, no secrets                   |

Two defaults deserve explanation. `process.list` is allow-by-default, so it must
not leak what the user is running — it reports SairiOS's own services and
nothing else. `system.settings.read` is allow-by-default, so it exposes only
provider mode, ports and the sandbox path.

Grant scopes are `allow once`, `allow for this context`, `deny`, and `deny and
remember`. A remembered decision for a context never applies to another context.

### Boundary 3 — path containment

Every filesystem path an agent proposes passes through one module
([services/permission-broker/src/sandbox.ts](services/permission-broker/src/sandbox.ts)).
Nothing else in SairiOS may build a path from agent input.

- Each context gets its own directory under the sandbox root.
- Absolute paths, `..` segments and NUL bytes are rejected.
- The resolved path is checked against the **real** path of the sandbox root, so
  a symlink planted inside the sandbox cannot point out of it.
- The check runs on the deepest existing ancestor, closing the gap where a
  not-yet-created file has no realpath of its own.
- Writes are capped (512 kB) and `files.delete` is non-recursive, so a grant for
  one file cannot remove a tree.

## Secrets

- **SairiOS never authenticates to a model provider.** It holds no provider API
  key and makes no provider call. Credentials belong to OpenClaw's own
  configuration. See [docs/OPENCLAW.md](docs/OPENCLAW.md).
- The only secret SairiOS may hold is `OPENCLAW_GATEWAY_TOKEN`, for a gateway on
  the same machine.
- No secret is ever baked into an image layer, a Dockerfile or a cloud-init file.
- Every structured log field passes through redaction
  ([packages/shared/src/redact.ts](packages/shared/src/redact.ts)) before it can
  reach a file, the audit trail or the activity panel.
- Crystallization strips memory whose key looks like a credential, whatever its
  scope, and everything marked sensitive.
- Synchronised context documents carry secret **names**, never values.

## Network posture

- All services bind to `127.0.0.1` by default. `startupChecks` warns loudly if
  that is changed, because **the services have no authentication**.
- CORS uses an explicit loopback allowlist, never `*`.
- The shell ships a Content Security Policy with `script-src 'self'`, no `eval`,
  and `connect-src` restricted to the three local services.
- `network.fetch` is simulated in v0. No egress happens on an agent's behalf.
- The gateway transport refuses an unencrypted `ws://` connection to anything
  other than loopback.

## Container posture

`containers/compose.yaml` is for **service development and tool sandboxing
only** — it is not how SairiOS is run as an operating system. Every service:
drops all capabilities, runs as non-root with `no-new-privileges`, uses a
read-only root filesystem with an explicit tmpfs, has CPU/memory/PID limits, and
sits on an internal network. The Docker socket is never mounted. The user's home
directory is never bind-mounted. No container is privileged.

## Known limitations

Stated plainly, because a security document that only lists strengths is
marketing.

1. **The v0 sandbox is not a strong isolation boundary.** It is path containment
   plus policy, in the same process tree as the services. It is not adequate
   against an attacker with code execution. Container and microVM isolation
   (gVisor, Firecracker, per-context microVMs) is a later milestone.
2. **The services have no authentication or authorization.** Any local process
   that can reach loopback can drive them. Multi-user machines are out of scope.
3. **The VM image has never been booted.** The build and run scripts were
   written without QEMU available. Their security properties are unverified.
   See [vm/README.md](vm/README.md).
4. **The OpenClaw integration is unverified scaffolding.** The wire protocol has
   not been exercised against a live gateway.
5. **There is no supply-chain verification** beyond `package-lock.json`. No
   signing, no SBOM, no reproducible-build attestation yet.
6. **The audit log is not tamper-evident.** It is append-only by convention, not
   by cryptography. A local attacker can rewrite it.
7. **Prompt injection is mitigated, not solved.** The boundaries above limit what
   a hijacked agent can _do_. They do not stop it from producing misleading
   content inside a valid document. Treat agent output as a claim, not a fact.
8. **No rate limiting or resource accounting** on the local services.
9. **`node:sqlite` is an experimental Node API.** Its stability guarantees are
   weaker than the rest of the standard library.

## Reporting scope

In scope: sandbox escape, permission-broker bypass, SairiUI validation bypass,
secret leakage into logs/templates/sync documents, XSS or code execution in the
shell, and privilege escalation through the systemd units or containers.

Out of scope for now: the unbooted VM image, the unverified OpenClaw codec,
denial of service against loopback services, and anything requiring pre-existing
code execution as the user.
