# OpenClaw integration

OpenClaw is the agent runtime SairiOS talks to. It is an **upstream dependency**
reached over its local gateway, never vendored into this repository.

> **Status: partly real, partly scaffolding. The split matters, so it is stated
> precisely rather than summarised.**
>
> | Piece                                   | State                                                                                                                                             |
> | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Version pin (`openclaw@2026.7.1-2`)     | **Real.** Read from the registry; engines checked against the guest's Node.                                                                       |
> | Guest install (cloud-init)              | **Real.** Installs the pinned version; a failure degrades to mock rather than breaking the boot.                                                  |
> | `sairios-openclaw.service` / `.path`    | **Real, and boot-tested as units.** The gateway process itself has not been run.                                                                  |
> | First-run setup (this document, path 0) | **Written and unit-tested; never executed against the real binary.** The flags come from upstream's CLI automation reference, read on 2026-08-01. |
> | Gateway handshake + envelope            | **Verified 2026-08-03** against a live gateway. Real frames captured to `providers/gateway-frames.fixture.json`; the tests run on them.           |
> | Gateway session flow                    | **Unverified.** The method and event names are the ones `hello-ok` advertised, so they exist; their params and payloads have not been observed.   |
>
> `SAIRIOS_AGENT_PROVIDER=mock` is fully working and remains the default. The
> first person to complete first-run setup on a real machine is the first person
> to execute `openclaw onboard` from SairiOS; expect to correct something.

## The two provider modes

```
SAIRIOS_AGENT_PROVIDER=mock       deterministic, offline, no credentials
SAIRIOS_AGENT_PROVIDER=openclaw   connect to a local OpenClaw Gateway
```

Mock mode is not a stub to be replaced. It is a supported mode: every test runs
against it, `make dev` uses it, and the VM boots into it. A change that breaks
mock mode is a bug.

## Where credentials live

**SairiOS never authenticates to a model provider.** It makes no provider API
call and bakes no credential into an image layer.

Earlier versions of this document also said SairiOS "holds no API key". First-run
setup made that sentence imprecise, so here is the exact claim:

- SairiOS **accepts** a key, once, in a form the user opened deliberately.
- It **writes** it to exactly one file, mode 0600, owned by the service account:
  `/var/lib/sairios/agent/agent-bridge/provider.env`.
- It **never reads it back**. No HTTP route returns a key, a key prefix, or a key
  length. `GET /setup` reports `keyPresent: true` and nothing more.
- It **never uses** it. Not one line of SairiOS code makes a request to a model
  provider. The file exists so systemd can hand it to the OpenClaw gateway.
- It **never logs** it, never puts it in a context, never carries it into a
  crystallized template, and never syncs it.

OpenClaw does not receive a copy either. Onboarding runs with
`--secret-input-mode ref`, so OpenClaw's config stores
`{ source: "env", id: "ANTHROPIC_API_KEY" }` — a pointer to the variable name.
The value is resolved at run time from the environment systemd supplies via
`EnvironmentFile=`.

So on a configured machine the secret exists in one file and in the memory of the
one process that needs it. If you want to revoke it, delete that file and
`systemctl stop sairios-openclaw.service`.

The key is also never a command-line argument. `argv` is readable by every user
on the machine through `ps`; the key travels to `openclaw onboard` in the child
process environment instead.

## What talking to a real gateway established

Run on 2026-08-03 against `openclaw 2026.7.1-2` in the SairiOS guest, with **no
provider credential involved**. The gateway starts unconfigured with
`--dev --auth none --allow-unconfigured`, which is enough to verify everything
that is not the model itself.

The envelope has three categories, and the message name is never in `type`:

```
req    {type:"req",   id, method, params}
res    {type:"res",   id, ok, payload|error}
event  {type:"event", event, payload, seq?, stateVersion?}
```

The handshake is `connect.challenge` (from the gateway, unprompted) → `connect`
(from us) → `hello-ok`. Protocol version 4. On success the gateway advertised
**218 methods and 30 events**, and granted `operator.read` + `operator.write`.

Two things this corrected:

1. **The placeholder codec could never have worked.** It switched on
   `frame.type` expecting an event name there, and looked for
   `session.prompt`, `session.created`, `message.delta`, `tool.call`,
   `ui.specification`, `session.done`. Not one of those exists.

2. **`client.id` and `client.mode` are closed enums**, enforced server-side. The
   `protocol.md` shipped _inside the openclaw package_ shows
   `"mode": "operator"` in its connect example; the gateway refuses it, because
   `operator` is a **role**. Valid modes are
   `webchat|cli|ui|backend|node|probe|test`. SairiOS connects as
   `gateway-client`/`backend` — the documented trusted loopback path, which may
   omit device pairing.

The one that will matter next: OpenClaw has its own approval round trip
(`exec.approval.requested` / `.resolved`, plus `exec.approval.request` /
`waitDecision` / `resolve`). SairiOS already has a permission broker with the
same shape. Those two must be wired to each other, or a user answers the same
question twice.

**What a key would add, and only this:** `models.list` returns `{"models":[]}`
on an unconfigured gateway. Running an actual turn — `sessions.create`,
`sessions.send`, and the `session.*` events that stream back — needs a
configured provider. That is the remaining unverified surface.

## Setup path 0 — first-run setup in the OS (what a user actually does)

On a booted SairiOS machine, the desktop opens with **Connect a model** when no
provider is configured. Choose a provider, choose a model, paste your key, press
Connect. That is the whole flow, and it is the intended one.

What happens behind it:

1. The shell POSTs to the agent bridge on loopback. This is the only request in
   the entire product that carries a secret.
2. The bridge validates provider, model and key shape **before** touching the
   filesystem. A key containing whitespace is refused outright — a newline would
   otherwise let a pasted value define extra variables in a systemd environment
   file.
3. The bridge writes the 0600 credential file and runs `openclaw onboard` in ref
   mode.
4. `sairios-openclaw.path` notices the file and starts the gateway.

Step 4 is why the bridge needs no privilege. It runs with `NoNewPrivileges=yes`
and cannot call `systemctl`; granting a network-facing HTTP service the ability
to start units would be a much larger concession than this feature is worth. The
file appearing is the signal instead.

Pressing **Not now** is a supported answer. The machine keeps running the mock
agent, which is a complete system — everything works except the thinking.

## Setup path 0b — connecting the VM, where you cannot paste

QEMU's default display has no clipboard channel. There is nothing to paste into,
and typing a forty-character key into a kiosk by hand is not a setup flow.

Two ways round it, and neither involves putting a key in the image.

**Set it from the host.** One command, and you never type into the VM at all:

```bash
make vm-connect
```

The VM must already be running — `make vm-run` first, or you get
`Connection refused` on the SSH port.

It opens an SSH tunnel to the guest's agent bridge and drives the same
`POST /setup` the wizard drives, so the real path runs: shape validation, the
0600 write, `openclaw onboard --secret-input-mode ref`, and the path unit
starting the gateway. The key is read from a hidden prompt, piped to curl on
stdin, and never appears in argv or on the host's disk. There is deliberately no
`--api-key` flag; passing one is refused with an explanation.

**Prefer the prompt.** If you must run it non-interactively, read the key from a
file:

```bash
SAIRIOS_PROVIDER_KEY="$(cat ~/.anthropic-key)" make vm-connect
```

Do **not** inline the key as `SAIRIOS_PROVIDER_KEY=sk-ant-… make vm-connect`. An
environment-assignment prefix is recorded in your shell's history file, in the
clear, in a place nobody treats as a secret store. A key that has been typed
that way should be rotated.

**Or use the wizard from your own browser**, where paste works normally:

```bash
make vm-tunnel
```

Then open <http://127.0.0.1:7800/#/os>. This forwards all four ports — the shell
on 7800 plus the three services it calls — because forwarding only 7800 gives
you a desktop where every request fails and looks like a broken build.

### Why the key is not baked into the image

It is the obvious idea. It is also the one thing CLAUDE.md rules out without
exception: no credential in source, tests, fixtures, image layers, Dockerfiles
or cloud-init files.

A key in `user-data` ends up in `vm/out/seed.iso` — an unencrypted file that
outlives the boot, is copied whenever the image is copied, and is readable by
anything running on the host. The 0600 file inside the guest is strictly better,
and both commands above are how a key gets there without one ever touching host
storage.

## Setup path 1 — interactive OpenClaw onboarding

1. Install OpenClaw following its own documentation. Do not install it from this
   repository; there is nothing here to install.
2. Run its onboarding and complete provider sign-in in OpenClaw's own interface.
   SairiOS is not involved and must not be given the credentials.
3. Start the gateway. Note the URL (default `ws://127.0.0.1:18789`) and the
   gateway token it issues.
4. Record the version you installed in `openclaw/config/version.json`, setting
   `openclaw.version` and `openclaw.verifiedAgainst`.
5. In `.env`:

   ```bash
   SAIRIOS_AGENT_PROVIDER=openclaw
   OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   OPENCLAW_GATEWAY_TOKEN=<the gateway token>
   ```

6. `make doctor`, then `make dev`.

## Setup path 2 — environment-based local development

For a scripted or containerised loop where interactive onboarding is awkward,
pass provider configuration to the **OpenClaw process**, not to SairiOS:

```bash
SAIRIOS_LLM_PROVIDER=...
SAIRIOS_LLM_MODEL=...
SAIRIOS_LLM_API_KEY=...
```

`scripts/dev.mjs` reads `.env` and passes the environment through to the
processes it starts. SairiOS itself does not read `SAIRIOS_LLM_API_KEY` to make
a provider call — it exists only so an OpenClaw process started from the same
shell can pick it up.

Never commit `.env`. Never put a key in a Dockerfile, a cloud-init file or an
image layer.

## Installing the SairiOS skill

`openclaw/skills/sairios-context/SKILL.md` teaches an agent the context model,
the SairiUI protocol, when to request permissions, and that it must never return
executable code as an interface. Install it into your OpenClaw skills directory
following OpenClaw's own instructions.

Without this skill an agent will produce documents SairiOS rejects. That is the
system working correctly, but it is not useful.

## What the bridge does with gateway output

Everything from the gateway is untrusted:

| Gateway sends         | Bridge does                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| a SairiUI document    | validates it; an invalid document becomes `ui-rejected` and never renders |
| a tool call           | checks the capability name, then raises a **permission broker request**   |
| a message             | records it in the context activity log                                    |
| an unknown frame      | ignores it, so a newer gateway does not break the session                 |
| nothing (unreachable) | emits an `error` event — it never falls back to mock output               |

That last row matters: a user who selected `openclaw` must never be shown
fabricated output because the gateway was down.

## Finishing the integration

To move this from scaffolding to verified:

1. Install and run a specific OpenClaw release.
2. Capture the real gateway frames for: session creation, prompt submission,
   streamed messages, tool calls, and completion.
3. Reconcile `codec.encodeIntention` and `codec.decodeFrame` in
   [services/agent-bridge/src/providers/openclaw.ts](../services/agent-bridge/src/providers/openclaw.ts)
   with those frames. The codec is isolated so this touches one function in each
   direction.
4. Add tests using the captured frames as fixtures, alongside the existing
   fake-transport tests.
5. Set `openclaw.version`, `openclaw.status: "pinned"`, `verifiedAgainst`, and
   `gatewayProtocol.status: "verified"` in `openclaw/config/version.json`.
6. Update the status banner at the top of this file and remove the SCAFFOLDING
   sentence from `OpenClawAgentProvider.status()`.

Do not do step 6 before steps 1 to 5.

## Troubleshooting

| Symptom                                                           | Cause                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `provider openclaw is not configured` in the shell                | `OPENCLAW_GATEWAY_TOKEN` is empty                                        |
| `Could not reach the OpenClaw Gateway`                            | the gateway is not running, or the URL is wrong                          |
| `An unencrypted gateway connection is only permitted to loopback` | a `ws://` URL to a non-loopback host; use `wss://`                       |
| `The OpenClaw transport is not wired in this build`               | the provider was constructed without a transport (this is what tests do) |
| Every response is rejected as an invalid interface                | the `sairios-context` skill is not installed                             |
