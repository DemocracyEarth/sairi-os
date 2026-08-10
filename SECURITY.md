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
- The shell ships a Content Security Policy of `script-src 'self'` with **no**
  `'unsafe-eval'`. To make that possible the SairiUI validator is precompiled at
  build time rather than compiled by AJV at runtime, and the generator asserts
  the output contains no `new Function`, `eval(` or `require(`. See
  [ADR 0009](docs/adr/0009-precompiled-schema-validator.md).

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

**Five of the twelve capabilities do something real. Six are simulated. One is
unimplemented.** Every row below says which, because describing only a
capability's _scope_ is what let a wrong count into three documents.

| Capability             | Default  | Real?         | v0 behaviour                                                |
| ---------------------- | -------- | ------------- | ----------------------------------------------------------- |
| `files.read`           | ask      | **real**      | reads a real file, sandbox only                             |
| `files.write`          | ask      | **real**      | writes a real file, sandbox only                            |
| `files.delete`         | **deny** | **real**      | deletes a real file, sandbox only, non-recursive            |
| `system.settings.read` | allow    | **real**      | returns live SairiOS settings. No env, no host, no secrets  |
| `audio.capture`        | ask      | **real**      | authorises one dictation; the browser captures, not SairiOS |
| `process.list`         | allow    | simulated     | SairiOS services only — host processes are never enumerated |
| `network.fetch`        | ask      | simulated     | no socket is opened                                         |
| `browser.open`         | ask      | simulated     | nothing is launched                                         |
| `clipboard.read`       | **deny** | simulated     | the real clipboard is never read                            |
| `clipboard.write`      | ask      | simulated     | the real clipboard is never written                         |
| `notifications.send`   | ask      | simulated     | no notification is delivered                                |
| `process.execute`      | **deny** | unimplemented | returns `not_implemented`; there is no shell                |

`system.settings.read` is the one that reads real while writing nothing, and it
is where the two honesty flags drifted apart: `realSideEffect` in policy.ts said
false because the name reads as "does this write", while the outcome correctly
reported `simulated: false`. The approval prompt was therefore understating what
the user was about to get.

`capability-honesty.test.ts` now executes every capability and asserts the
descriptor and the outcome agree, so the two cannot disagree again — and the
counts above are pinned by that same test rather than by counting greps.

Two defaults deserve explanation. `process.list` is allow-by-default, so it must
not leak what the user is running — it reports SairiOS's own services and
nothing else. `system.settings.read` is allow-by-default, so it exposes only
provider mode, ports and the sandbox path.

`audio.capture` is the odd one, and the difference is deliberate rather than an
oversight. Every other capability names a resource the broker can reach: a file,
a process, a setting. A microphone belongs to whichever machine runs the
browser, which over a tunnel is the user's laptop and not the guest. **So the
broker authorises this one without performing it**, and its enforcement is real
but indirect: the shell opens no microphone without an allowed-and-executed
request, and policy is re-checked per utterance, so a "deny and remember" stops
the next one. What the broker cannot do is stop some other page on that machine
from asking for the same microphone itself.

The compensating property is the strongest privacy guarantee in the system.
Capture and transcription both happen in the page against an on-device model, so
**no audio and no transcript ever reach SairiOS** — the broker records that a
microphone was authorised and is structurally unable to record what was said.
`audio-capture.test.ts` asserts that from the other side: speech sent to the
broker anyway is neither read nor echoed back. It is never `allow` by default,
because a microphone records people who are not users of this machine and were
never asked. See [ADR 0012](docs/adr/0012-voice-as-input-transport.md).

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

## Relayed approvals (OpenClaw)

OpenClaw has its own approval round trip: it raises `exec.approval.requested`
and blocks until it is told the answer. Left unwired, both systems prompt and a
user answers the same question twice — the second time in OpenClaw's terms,
where SairiOS's policy, audit log and sandbox have no say.

There is now exactly one decision, and it is SairiOS's
([services/agent-bridge/src/approval-relay.ts](services/agent-bridge/src/approval-relay.ts)).

**A relayed approval is not a broker execution, and the two must not be
conflated:**

|                  | who acts                         | contained?                       | audited?          |
| ---------------- | -------------------------------- | -------------------------------- | ----------------- |
| broker execution | the broker                       | yes — path containment, size cap | yes               |
| relayed approval | **OpenClaw**, in its own process | **no**                           | the decision only |

Every rule follows from that asymmetry:

- **An `allow` policy never auto-approves a relay.** `process.list` is `allow`
  because a _sandboxed_ listing is harmless; that is not consent for OpenClaw to
  run it against the real machine unprompted. An `allow` policy is downgraded to
  a prompt. Treating the two as one value is the easiest way to turn this relay
  into a privilege escalation.
- **A `deny` policy refuses outright**, without prompting and without proposing.
- **`process.execute` is never relayed**, whatever the policy says. SairiOS does
  not implement unrestricted execution, and an approval prompt is not a
  substitute for not having built it.
- **It fails closed.** An unreachable broker, a lost request, an unrecognised
  status and an expired timeout all deny. The only path to `allow` is a broker
  request a human moved to `allowed`. An unanswered prompt is not consent.
- **The user is told where it runs.** An approved relay says plainly that
  OpenClaw performs the action outside the SairiOS sandbox, and the context log
  records it. Same principle as the `simulated` flag: a user must always know
  what actually happened.

## Secrets

- **SairiOS never authenticates to a model provider.** No line of SairiOS code
  makes a request to a provider. Credentials are OpenClaw's business. See
  [docs/OPENCLAW.md](docs/OPENCLAW.md).
- **It does take custody of one key, briefly and only when asked.** First-run
  setup accepts a provider key and writes it to exactly one file — mode 0600,
  owned by the service account, at
  `${SAIRIOS_DATA_DIR}/agent-bridge/provider.env`. It is never read back: no
  route returns a key, a prefix, or a length. `GET /setup` answers
  `keyPresent: true` and stops there. This is written custody, not use.
  ([services/agent-bridge/src/setup.ts](services/agent-bridge/src/setup.ts))
- OpenClaw gets a pointer, not a copy. Onboarding runs with
  `--secret-input-mode ref`, so its config holds `{source:"env", id:"<VAR>"}` and
  the value is resolved at run time from the environment systemd provides.
- A key is never a command-line argument, because `argv` is world-readable
  through `ps`. It reaches `openclaw onboard` in the child's environment.
- A key containing whitespace is refused. In a systemd environment file a
  newline would let a pasted value define further variables for the gateway
  process; the validation exists for that case specifically.
- The only other secret SairiOS may hold is `OPENCLAW_GATEWAY_TOKEN`, for a
  gateway on the same machine.
- No secret is ever baked into an image layer, a Dockerfile or a cloud-init file.
- Every structured log field passes through redaction
  ([packages/shared/src/redact.ts](packages/shared/src/redact.ts)) before it can
  reach a file, the audit trail or the activity panel.
- Crystallization strips memory whose key looks like a credential, whatever its
  scope, and everything marked sensitive.
- Synchronised context documents carry secret **names**, never values.
- A crystallized template keeps **the source context's name**, in its provenance
  event (`Crystallized from "…"`). Deliberate — a template with no traceable
  origin is worse — but it is a real tradeoff, because a template is the artifact
  most likely to be shared and a context name can itself be sensitive. Nothing
  else from the source survives; `crystallize.test.ts` pins exactly that, so it
  stays a decision rather than an accident.

## Network posture

- All services bind to `127.0.0.1` by default. `startupChecks` warns loudly if
  that is changed, because **the services have no authentication**.
- The browser reaches the services through same-origin prefixes proxied by the
  shell process ([ADR 0011](docs/adr/0011-same-origin-service-proxy.md)). The
  proxy's route table is fixed at load and its upstream host is a constant:
  nothing about the destination comes from the request, because a proxy that
  reads its target from a path or a header is an SSRF primitive, and this one
  sits in front of the permission broker.
- Collapsing four origins into one makes a single authenticated front door
  **possible**. It does not add one. The services still have no authentication
  and this changes nothing about that; see the note on remote access below.
- CORS uses an explicit loopback allowlist, never `*`. It no longer applies to
  the browser path at all, since same-origin requests are not checked — it
  remains for a dev shell pointed at services directly with `VITE_*`.
- The shell ships a Content Security Policy with `script-src 'self'`, no `eval`,
  and `connect-src 'self'` — no origin beyond its own.
- `network.fetch` is simulated in v0. No egress happens on an agent's behalf.
- The gateway transport refuses an unencrypted `ws://` connection to anything
  other than loopback.

### System egress: the hosted provider

Until `SAIRIOS_AGENT_PROVIDER=hosted` existed, SairiOS talked only to loopback,
and the two statements "no agent egress" and "no egress" were the same
statement. They are no longer, so the distinction is written down rather than
left to be inferred from a provider file:

- **No egress on an agent's behalf.** Unchanged, and not negotiable.
  `network.fetch` stays simulated. An agent still cannot cause a request to a
  destination it chose.
- **Egress by the system, when an operator selects it.** The hosted provider
  sends the intention and the context's id, type and name to a fixed endpoint
  (`SAIRIOS_GATEWAY_URL`, default `https://gateway.sairi.computer`) and streams
  the answer back. The destination is configuration, never model output.

What that means in practice, and what it costs:

- **The intention leaves the machine.** Whatever a user types or dictates into
  a context is sent to the gateway. That is what selecting hosted inference
  buys, and there is no version of it that keeps the text local.
- **Context contents do not.** Files, run history, memory and prior documents
  stay put. The request body is four fields; nothing walks the context.
- **The instance holds no provider credential.** Only an instance token, which
  identifies this instance and nothing else. Losing it costs this instance's
  quota; a leaked provider key would cost the account. That asymmetry is the
  reason the gateway exists ([ADR 0015](docs/adr/0015-hosted-inference-gateway.md),
  and [ADR 0010](docs/adr/0010-provider-credential-custody.md) for why a key in
  an image was never an option).
- **The token never crosses plaintext.** `transportIsSafe` allows `https`
  anywhere and `http` only on loopback, and refuses before the request is
  built rather than after — a bearer token on plain `http` works, which is
  exactly why nobody notices it is readable by everything on the path.
- **The response is validated like any other.** SairiOS running the server does
  not make it a trusted source. Documents are validated in the provider, again
  in the bridge, again in the renderer. Invariant 4 has no first-party
  exception, and a compromised gateway is the case this defends.
- **It is opt-in and off by default.** Mock remains the default provider and
  still needs no credential, no network and no external process.

The endpoint is **SCAFFOLDING**: the client has never contacted a live gateway,
because the gateway has not been built. Nothing has been verified end to end.

### Remote access, and the door in front of it

Reaching SairiOS from another machine used to be described here as a precondition
rather than a configuration, because **the broker's three-phase separation does
not survive a network path on its own**. `POST /requests`,
`POST /requests/{id}/decision` and `POST /requests/{id}/execute` are three
unauthenticated routes; anyone who could reach port 7803 performed all three
— _including the approval_ — and the resulting grant could not be withdrawn.
The "human in the loop" the whole design rests on was, at the transport layer,
an unauthenticated HTTP route.

Those preconditions are now met, in the order they were written:

1. **The services are behind an authenticated front door.** Since
   [ADR 0011](docs/adr/0011-same-origin-service-proxy.md) the shell process is
   the only thing that needs to be reachable, and since
   [ADR 0013](docs/adr/0013-authenticated-front-door.md) it refuses to listen
   off loopback without an access token. Not a warning — a startup error, with
   no override flag, because a control an operator has to remember to switch on
   is off on the machine where it mattered.

   The services gained the same refusal, because a door on the shell does
   nothing for someone who dials port 7803 directly. `SAIRIOS_BIND_HOST` off
   loopback is now a startup error too, unless
   `SAIRIOS_ALLOW_UNAUTHENTICATED_BIND=yes-i-understand` is set — which the
   containers do, being on an internal network with no route off the box. The
   shell reads its own `SAIRIOS_SHELL_BIND_HOST`, so exposing the shell and
   exposing the unauthenticated broker are no longer the same instruction.

2. **Grants are revocable.** `POST /policies/revoke` withdraws a remembered
   decision by capability, by context, or — explicitly — all of them, and writes
   a `revoked` entry to the audit log. Refusing to guess from an empty filter is
   deliberate: a revoke that clears everything when its argument is accidentally
   `undefined` is a footgun aimed at the one table a user cannot reconstruct.

   Revocation also reaches requests already in flight. One that policy allowed
   on its own is refused at execution with `grant_revoked` once the grant behind
   it is gone; one a human explicitly allowed still runs, because withdrawing a
   standing grant is not the same as retracting an individual "allow once".

3. **Transport.** Prefer a tunnel or an overlay network that keeps the services
   on loopback over anything that terminates TLS off-box. See
   [docs/REMOTE.md](docs/REMOTE.md), which ranks the options and says why
   Cloudflare Tunnel is not among the recommended ones.

What the door is: a bearer token for a single-user machine, the same model
code-server and Gitpod use. Whoever holds it is the user. The exchange sets an
`HttpOnly; SameSite=Strict` cookie, and `SAIRIOS_BEHIND_TLS=true` adds `Secure`.

What it is not: multi-user, per-context, expiring, or a defence against code
already running on the machine — an agent there reaches 7801-7803 directly and
never passes this door. The threat model above says the local machine is
trusted; this protects the network edge, which is the boundary remote access
actually creates. **It does not encrypt anything.** A bearer token over plain
http on an untrusted network is readable in transit; the transport must carry
the TLS.

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
10. **A remembered decision can be revoked, but not yet from the desktop.**
    `POST /policies/revoke` withdraws one by capability, by context, or all of
    them, persists the change, and audits it — so a grant no longer survives
    until someone edits a JSON file. What is still missing is the UI: the shell
    exposes `brokerApi.revoke` and nothing calls it, so today revoking means an
    HTTP request. Nothing clears a grant automatically when its context is
    archived or deleted, either.

## Reporting scope

In scope: sandbox escape, permission-broker bypass, SairiUI validation bypass,
secret leakage into logs/templates/sync documents, XSS or code execution in the
shell, and privilege escalation through the systemd units or containers.

Out of scope for now: the unbooted VM image, the unverified OpenClaw codec,
denial of service against loopback services, and anything requiring pre-existing
code execution as the user.
