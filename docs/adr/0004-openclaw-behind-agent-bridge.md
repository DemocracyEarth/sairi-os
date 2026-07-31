# 0004. OpenClaw as a pinned dependency behind the agent bridge

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

SairiOS needs an agent runtime: something that runs a model, holds a conversation, calls
tools, streams progress and reports results. Building one is a project in itself, and it is
not the project SairiOS is. OpenClaw already does it.

The question is not whether to use OpenClaw. It is how to depend on it.

Three forces shape the answer.

First, coupling. OpenClaw is upstream software with its own release cadence, its own
internal protocol between its components, and its own opinions that will change. Anything
in SairiOS that knows those details breaks when they change, and the further that knowledge
spreads, the more expensive each upstream release becomes.

Second, testability. Nothing in SairiOS should require a model provider, an API key or a
network connection in order to run, build or test. Contributors must be able to clone the
repository and get a working environment offline, on the first try, with no account
anywhere. CI must be able to run the full suite with no secrets configured.

Third, credentials. Model provider API keys are the most sensitive material this system
touches. Every process that holds one is a process that can leak one, through a crash dump,
a log line, an error report, a memory disclosure or an image layer that captured a config
file. The fewer places a key exists, the better, and the shell (a browser process rendering
untrusted content) is the worst possible place for it.

## Decision

OpenClaw is an **upstream pinned runtime dependency**. Its source is never vendored into
this repository. SairiOS reaches it only through the `agent-bridge` service, behind an
`AgentProvider` interface.

### The interface and its implementations

`AgentProvider` is a narrow interface owned by SairiOS: start a run for a context, stream
events, cancel a run, report status. Two implementations exist, selected by
`SAIRIOS_AGENT_PROVIDER`:

- **`mock`** (the default). A deterministic in-process provider. No network, no API key, no
  OpenClaw. It produces a scripted but structurally complete event stream, including tool
  proposals and permission requests, so the whole system can be exercised end to end
  offline. `mock` mode working offline is a hard requirement, not a convenience. If a
  change breaks `mock`, the change is wrong.
- **`openclaw`**. Connects to a locally running OpenClaw Gateway over the URL in
  `OPENCLAW_GATEWAY_URL` (default `ws://127.0.0.1:18789`), authenticating with
  `OPENCLAW_GATEWAY_TOKEN`.

### The shell never speaks to OpenClaw

The desktop shell talks to `agent-bridge` over SairiOS's own HTTP and WebSocket API. It
does not know OpenClaw's protocol, does not hold its token, does not know its URL, and does
not change when OpenClaw changes. If OpenClaw were replaced entirely, the shell would not
be touched.

### Version pinning

The OpenClaw version is pinned explicitly (`OPENCLAW_VERSION`, and the checked-in pin file
the image build reads). Upgrades are deliberate: bump the pin, run the suite in both
provider modes, run the full-system test from ADR 0002, then merge. Upstream releases never
arrive silently, and a bad upstream release cannot break a user who has not upgraded.

### Normalized event stream

`agent-bridge` translates OpenClaw's events into SairiOS's own event vocabulary, tied to
context ids and context lifecycle statuses (ADR 0005) and to permission requests (ADR
0006). Consumers see SairiOS events. The translation lives in exactly one place, so an
upstream event-format change is a diff in one module with one test file.

### Credentials stay in OpenClaw

Provider credentials live in **OpenClaw's own configuration**, established through its own
onboarding. They do not live in SairiOS process memory, in SairiOS configuration files
that get read into a SairiOS process, in the shell, or in any image layer. The
`SAIRIOS_LLM_*` variables exist only for environment-based local development where they are
passed through to the OpenClaw process at start; SairiOS itself never reads
`SAIRIOS_LLM_API_KEY` to make a provider call. The intended state is that those variables
are empty and OpenClaw owns its own secrets.

## Consequences

### Positive

- SairiOS gets a working agent runtime, with tool calling and streaming, without building
  one.
- The system runs, builds and tests fully offline with no credentials. A new contributor is
  productive without an account anywhere.
- CI needs no secrets for the default path, which removes an entire class of pipeline risk.
- Upstream changes are absorbed in one service, usually in one module.
- Provider keys exist in one process that SairiOS does not write, so a bug in SairiOS code
  cannot leak a key it never had.
- Replacing OpenClaw, or supporting a second runtime alongside it, is a new
  `AgentProvider` implementation rather than a rewrite.
- The `mock` provider makes agent behavior testable deterministically, which is otherwise
  very hard.

### Negative

- The `AgentProvider` interface is a lowest common denominator. Capabilities specific to
  OpenClaw are either unavailable or have to widen the interface, and every widening erodes
  the boundary.
- Two providers means two code paths, and `mock` will drift from `openclaw` unless it is
  actively maintained against it. Drift shows up as tests that pass while the real path is
  broken.
- Running OpenClaw is now a user-facing prerequisite for the non-mock path, with its own
  install, configuration and failure modes that SairiOS has to explain but does not
  control.
- Debugging crosses a process and protocol boundary. A misbehaving run may be SairiOS, the
  bridge, the gateway or the model, and answering that takes longer than reading one stack
  trace.
- Pinning means security updates in OpenClaw do not reach users automatically. Watching
  upstream advisories is now a standing responsibility.

### Neutral

- `agent-bridge` is the only service that opens an outbound connection for agent work,
  which makes it the natural place for rate limiting, run accounting and audit.
- The gateway is expected on loopback. Any other topology is a deployment decision, not an
  architecture change.
- The normalized event vocabulary is versioned with the rest of SairiOS's protocols, not
  with OpenClaw's.
- OpenClaw's own tool execution is still subject to SairiOS's permission model for anything
  that touches the user's environment through SairiOS. The sandbox directory and the broker
  in ADR 0006 remain the boundary.

## Alternatives considered

**Vendor OpenClaw's source into the repository.** Copy it in, modify freely.
Rejected because: the moment it is modified it is a fork, and every upstream release
becomes a merge. Worse, upstream security fixes stop arriving as updates and start arriving
as work. The apparent short-term benefit (patch anything immediately) is exactly the
mechanism that makes long-term maintenance unaffordable.

**Call a model provider API directly from the shell.** Skip the agent runtime; have the UI
talk to the provider.
Rejected because: it puts provider credentials in the UI process, which is a browser
process rendering untrusted content. It also throws away the tool runtime, the conversation
state and the streaming machinery, all of which would then have to be rebuilt in the least
suitable place in the system.

**Couple the UI directly to the OpenClaw gateway protocol.** Let the shell speak the
gateway protocol and drop the bridge.
Rejected because: it binds the interface to undocumented internals that change without
notice, it puts the gateway token in the shell, and it makes the UI untestable without a
running gateway. It removes exactly the seam that makes upstream changes cheap.

**Build an agent runtime in-house.** Own the whole stack.
Rejected because: it is a large, ongoing project with no product differentiation for
SairiOS. The differentiation is contexts and the environment, not the loop that calls a
model.

## Revisit when

- The `AgentProvider` interface has to grow repeatedly to expose OpenClaw specifics, which
  is the signal that the abstraction no longer matches reality.
- A second real provider is added, which is the honest test of whether the interface is an
  abstraction or a description of one implementation.
- OpenClaw's release cadence, licensing or direction changes in a way that makes the pin
  expensive to move or the dependency uncomfortable to hold.
- `mock` drifts far enough from `openclaw` that green tests stop predicting working
  behavior. The fix is contract tests both providers must pass, and that is worth doing
  before it is forced.
- Credential handling changes upstream such that OpenClaw no longer owns provider secrets,
  which would reopen where keys live.
