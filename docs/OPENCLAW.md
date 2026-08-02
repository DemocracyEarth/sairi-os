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
> | Gateway wire protocol                   | **Scaffolding.** The frame shapes in `services/agent-bridge/src/providers/openclaw.ts` are placeholders.                                          |
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
