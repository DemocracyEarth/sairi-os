# SairiOS OpenClaw workspace

This directory is the workspace an OpenClaw agent is pointed at when SairiOS
runs with `SAIRIOS_AGENT_PROVIDER=openclaw`.

## What lives here

```
openclaw/
├── config/
│   └── version.json     Pinned upstream OpenClaw version and protocol status
├── skills/
│   └── sairios-context/ The skill that teaches an agent how SairiOS works
└── workspace/           This directory: the agent's working root
```

## What does NOT live here

- **OpenClaw itself.** It is an upstream runtime dependency, not vendored
  source. See `docs/adr/0004-openclaw-behind-agent-bridge.md`.
- **Credentials of any kind.** Provider API keys belong to OpenClaw's own
  configuration, outside this repository. SairiOS never reads a model provider
  key and never puts one in an image layer. `.gitignore` excludes
  `openclaw/config/local/` and any credential file placed here by mistake.
- **Context data.** Contexts live in the context service store under
  `SAIRIOS_DATA_DIR`. Agent file actions are confined to the per-context
  sandbox under `SAIRIOS_SANDBOX_DIR`, not to this directory.

## The boundary

The agent never talks to the desktop shell and the shell never talks to the
agent. Everything crosses through the `agent-bridge` service, which:

- normalizes gateway events into the SairiOS event shape;
- validates every SairiUI document before it can reach the renderer;
- turns a tool call into a **permission broker request**, which the agent
  cannot approve.

## Status

The OpenClaw provider in this repository is **scaffolding**. The connection
lifecycle is implemented and unit-tested against a fake transport; the wire
protocol has not been verified against a live gateway. `make doctor` and the
bridge's `/provider` endpoint both say so.

`SAIRIOS_AGENT_PROVIDER=mock` is fully working and is the default.

See `docs/OPENCLAW.md` for the two setup paths and the exact steps to finish
and verify the integration.
