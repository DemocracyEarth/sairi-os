# 0010 — SairiOS takes custody of a provider key, and what that costs

- **Status:** accepted
- **Date:** 2026-08-02
- **Supersedes part of:** [0004](0004-openclaw-behind-agent-bridge.md)

## Context

Until now SairiOS could say something clean: it holds no provider API key at all.
Credentials were OpenClaw's business, configured by running OpenClaw's own
onboarding in a terminal. `SECURITY.md` said so, `docs/OPENCLAW.md` said so, and
it was true.

That claim was easy to keep because SairiOS was not yet something you boot. Once
it boots into a desktop as its own operating environment, the sentence "install
OpenClaw and run its onboarding in a terminal" describes a product that doesn't
work. A person who boots an OS should be able to make it useful from inside it.
The requirement is plain: the OS setup asks for an LLM API key.

So the key has to pass through SairiOS. The question is what we give up, and how
little we can give up.

## Options considered

**A. Keep the clean claim; make the user drop to a shell.**
Preserves the property perfectly and abandons the product goal. SairiOS has a
terminal, but it is a context CLI with no shell by design — so this would mean
telling people to leave the OS to configure the OS.

**B. Take the key and let SairiOS call the provider directly.**
Simplest to build, and the worst outcome. It makes SairiOS a model client,
duplicates what OpenClaw exists to do, and turns every future provider into our
problem. It also puts the key on a hot path in a network-facing service.

**C. Write the key into OpenClaw's credential store ourselves.**
Couples us to an undocumented private format. When upstream changes it we break,
and the failure would be a silently non-working agent.

**D. Take the key, write it to one 0600 file, and hand OpenClaw a _reference_.**
Chosen. OpenClaw documents `--secret-input-mode ref`, which stores
`{source: "env", id: "<VAR>"}` in its auth profile rather than the secret, and
resolves the value from the process environment at run time.

## Decision

Option D.

The key's entire life:

1. It arrives once, over loopback, in a `POST /setup` body — from a form the user
   deliberately opened.
2. It is validated before anything is written: known provider, known model,
   plausible shape, no whitespace.
3. It is written to `${SAIRIOS_DATA_DIR}/agent-bridge/provider.env`, mode 0600,
   owned by the service account.
4. It is passed to `openclaw onboard` **in the child's environment**, never in
   `argv`.
5. `sairios-openclaw.path` sees the file and starts the gateway, which receives
   the variable through `EnvironmentFile=`.

And what never happens: it is never returned by any route, never logged, never
placed in a context, never carried into a crystallized template, never synced,
and never baked into an image layer.

## The honest cost

We traded an absolute for a bounded one. "SairiOS holds no key" was easy to
verify — there was no code to check. "SairiOS holds a key it never reads back" is
weaker: it depends on the code continuing to behave, which means it depends on
tests. `services/agent-bridge/src/setup.test.ts` therefore asserts absence
directly — the key must not appear in the status object, in any log line, in
`argv`, or in an onboarding failure message. Those tests are the claim.

Two smaller costs:

- The agent bridge now spawns a process. It did not before. It is a fixed argv
  with no shell, and nothing user-controlled reaches it except a provider id
  validated against a list of two — but the capability is new and should be
  weighed by anyone reviewing that service.
- `ProtectHome=read-only` had to be punched out for `/home/sairi/.openclaw`, so
  onboarding can write OpenClaw's config. One directory, named explicitly.

## Why the path unit

The bridge cannot start the gateway itself: it runs with `NoNewPrivileges=yes`
and no `systemctl`. The alternatives were to grant it unit-starting privilege —
an enormous concession for a network-facing HTTP service — or to find another
signal.

The credential file appearing _is_ the signal. `sairios-openclaw.path` watches
for it. Setup stays entirely unprivileged, and the only thing the bridge can
cause is exactly one unit to start.

## Consequences

- A booted SairiOS machine is useful without a terminal.
- Revocation is `rm` on one file plus `systemctl stop`.
- Mock mode remains the default and remains fully supported. "Not now" is a real
  answer, and a machine that never connects a provider is a working machine.
- Adding a provider means reading upstream's documented `--auth-choice` value for
  it, not guessing. A wrong value fails deep inside onboarding with an unhelpful
  message.
