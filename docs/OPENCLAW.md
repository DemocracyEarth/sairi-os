# OpenClaw integration

OpenClaw is the agent runtime SairiOS talks to. It is an **upstream dependency**
reached over its local gateway, never vendored into this repository.

> **Status: scaffolding.**
> The `openclaw` provider has never been run against a live OpenClaw Gateway on
> the machine this repository was scaffolded on. The connection lifecycle
> (configuration, dial, timeout, teardown, error reporting) is implemented and
> unit-tested against a fake transport. The wire message shapes are placeholders.
> `SAIRIOS_AGENT_PROVIDER=mock` is fully working and is the default.

## The two provider modes

```
SAIRIOS_AGENT_PROVIDER=mock       deterministic, offline, no credentials
SAIRIOS_AGENT_PROVIDER=openclaw   connect to a local OpenClaw Gateway
```

Mock mode is not a stub to be replaced. It is a supported mode: every test runs
against it, `make dev` uses it, and the VM boots into it. A change that breaks
mock mode is a bug.

## Where credentials live

**SairiOS never authenticates to a model provider.** It holds no API key, makes
no provider call, and bakes no credential into an image layer.

Provider credentials belong to OpenClaw's own configuration. SairiOS holds at
most one secret, `OPENCLAW_GATEWAY_TOKEN`, which authenticates it to a gateway
running on the same machine.

That is why `.env.example` leaves `SAIRIOS_LLM_*` empty and tells you to prefer
OpenClaw onboarding.

## Setup path 1 — interactive OpenClaw onboarding (preferred)

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
