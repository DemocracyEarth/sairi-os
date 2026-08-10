# ADR 0015 — A hosted inference gateway, so an instance holds no provider key

**Status:** accepted, unimplemented server side
**Date:** 2026-08-09
**Supersedes nothing.** Extends [ADR 0010](0010-provider-credential-custody.md).

## Context

A first run of SairiOS opens a setup wizard, asks for a provider credential, and
until it gets one runs a deterministic mock agent. For an operating environment
whose entire premise is that the interface is generated per intention, that is a
weak introduction: the first thing a new user meets is a form, and the second is
a system that cannot do the thing it is for.

The obvious fix is to ship a key. Put a provider credential in the VM image, and
SairiOS works the moment it boots.

That is forbidden here, and the reasons are not stylistic:

- a key in a qcow2 layer is extractable by anyone who obtains the image, and
  images are meant to be copied;
- it is billed to whoever generated it, for everyone who ever runs a copy;
- it cannot be rotated without reshipping the image;
- it would sit in a git-tracked cloud-init file, violating invariant 8 directly.

[ADR 0010](0010-provider-credential-custody.md) already settled that SairiOS
does not custody provider credentials — OpenClaw's configuration does. What it
did not settle is what a user gets when they have no credential and no intention
of getting one.

## Decision

Add a third provider, `hosted`, that talks to an inference gateway SairiOS
operates. The provider key lives on that server. An instance holds only an
**instance token** that identifies it.

```
POST {gatewayUrl}/v1/turns
Authorization: Bearer {instanceToken}
Accept: application/x-ndjson

{ "contextId", "contextType", "contextName", "intention" }
→ NDJSON, one AgentEvent per line
```

Four decisions inside that, each of which had a plausible alternative:

**The server owns the prompt → SairiUI contract.** Teaching a model to emit a
document from the sixteen-component catalog is the hard, unfinished part — it is
the reason a live OpenClaw turn still does not produce an interface. Putting it
server-side means it can change without reshipping a VM image, and every
instance improves at once. The alternative — the prompt in the guest — ties the
most volatile part of the system to the least deployable one.

**The client validates anyway.** SairiOS running the server does not make the
server trusted; it makes it a source SairiOS happens to run. A document from the
gateway passes the same validator as one from anywhere else, and is rejected
whole if it fails. Invariant 4 has no first-party exception, and this is
precisely the boundary where one would be tempting.

**Stateless turns.** No remote session to create, resume or leak. `createSession`
mints a local id for the bridge's bookkeeping and nothing else, so a crashed
instance leaves nothing behind on the server.

**Refuse plaintext before sending.** `transportIsSafe` permits `https` anywhere
and `http` only on loopback. Loopback is exempt because there is no path to be
on, which keeps local development possible without weakening the rule. The check
runs before the request is constructed: a bearer token sent over plain `http`
works perfectly, which is exactly why the mistake survives.

## Consequences

**This is the first outbound connection SairiOS makes on its own.** Every prior
version talked only to loopback, and "no agent egress" and "no egress" were the
same sentence. They are not any more. `network.fetch` stays simulated — an agent
still cannot reach a destination it chose — but the system now calls out when an
operator selects this provider. SECURITY.md records the distinction rather than
leaving it implicit.

**The intention leaves the machine.** There is no version of hosted inference
where it does not. Context contents do not: the body is four fields, and files,
runs, memory and prior documents stay local. A user who wants nothing to leave
runs `mock` or `openclaw`, which is why both remain.

**A privacy question becomes a product question.** Someone operates that server,
and what it logs and retains is now part of what SairiOS is, not an
implementation detail of a provider. That policy does not exist yet and must
before the gateway serves anyone.

**Abuse control is now load-bearing.** A token that grants inference is a token
worth stealing. Per-instance quotas, rate limits and revocation are gateway
prerequisites, not later work — an unmetered endpoint with a guessable token is
someone else's compute bill.

**Mock stays the default.** Invariant 6 is untouched: no credential, no network,
no external process, and every test still runs against it.

## Status of the implementation

The client exists and is tested. **The server does not exist.** Nothing here has
been contacted, and no turn has ever been run against it. The wire contract is
written down in `services/agent-bridge/src/providers/hosted.ts` precisely
because a contract that lives in one implementation of one side is not a
contract.

What would verify this: a gateway answering `/v1/turns` with an NDJSON stream
ending in a valid SairiUI document, an instance configured with only
`SAIRIOS_INSTANCE_TOKEN`, and an interface on screen that no local model
produced.

## Alternatives considered

**Ship a key in the image.** Rejected above. It is the option users ask for and
the one that cannot be made safe.

**Bundle a local model.** No credential, no egress, genuinely private — and it
puts multi-gigabyte weights in the image, demands hardware a laptop VM does not
have, and the small models that would fit are not close to emitting a valid
document from a sixteen-component catalog. Worth revisiting when both halves of
that change; it is the only option that keeps the intention on the machine.

**Leave it at the wizard.** Honest, and the status quo. It just means the
default experience of an operating environment built around generated interfaces
is one that cannot generate them.
