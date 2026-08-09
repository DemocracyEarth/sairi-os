# 0013. One authenticated front door, and a refusal to listen without it

- Status: Accepted
- Date: 2026-08-09
- Deciders: SairiOS founding engineering

## Context

SairiOS's three services have no authentication. That is deliberate and recorded: they bind
loopback and trust that only the local user can reach them, and `startupChecks` warns when the
bind host changes. [ADR 0011](0011-same-origin-service-proxy.md) put all four surfaces behind
one origin, which left exactly one process needing to be reachable for someone to use a cloud
instance from a browser.

But a warning is not a control. The pre-existing posture was that an operator who set
`SAIRIOS_BIND_HOST=0.0.0.0` got a log line reading "services have no authentication and must
not be reachable off-host" and a fully working, fully exposed permission broker. Anyone who
found the port could propose an action, approve it, and execute it — all three phases are
unauthenticated routes — and the resulting `remember: true, global: true` grant could not be
withdrawn without editing a JSON file on the host.

[SECURITY.md](../../SECURITY.md) already stated the fix as an ordered precondition:
authenticate the decision route, make grants revocable, then transport. This ADR is the first
two.

The obvious alternatives: put auth in each service (three implementations of one thing, and
the services stop being loopback-simple); use OS-level authentication such as a unix socket
peer credential (correct for a local desktop, useless for the browser-from-elsewhere case that
motivated this); or run an OIDC provider (right for a shared deployment, absurd for one person
and one VM).

## Decision

**One bearer token on the shell's origin.** `SAIRIOS_ACCESS_TOKEN` guards every path the
process serves, including the three service prefixes. A sign-in page exchanges the token once
for an `HttpOnly; SameSite=Strict` cookie; `SAIRIOS_BEHIND_TLS=true` adds `Secure`. Only
`/healthz` and the sign-in route itself are public. The services are untouched and still bind
loopback.

**Binding off loopback without a token is a startup error.** No override flag, no
warn-and-continue. `resolveAccess` runs before the server is created, so an unsafe
configuration never reaches a listening socket.

**Remembered grants are revocable.** `POST /policies/revoke` takes a capability, a context, or
an explicit `all: true`, persists the change and writes a `revoked` audit entry.

## Consequences

**The interlock is the actual feature.** A token an operator must remember to switch on is off
on the machine where it mattered. Inverting it — the process refuses rather than warns — is
the difference between a control and a suggestion, and it is why there is no escape hatch to
test here: adding one would restore exactly the failure mode being removed.

**One door covers four surfaces**, which is only true because of ADR 0011. Before same-origin
prefixes this would have needed the same check in four places, or three services learning
about tokens.

**The services needed their own gate anyway, and the first version of this change did not have
one.** A door on the shell does nothing for someone who dials 7803 directly, and
`SAIRIOS_BIND_HOST=0.0.0.0` did exactly that with only a `warn` — an adversarial review of this
change reproduced it, returning the full context list to a LAN address. Two fixes: `readEnv`
now refuses that bind unless `SAIRIOS_ALLOW_UNAUTHENTICATED_BIND=yes-i-understand` is set
(containers do, since they are on an internal network with no route off the box), and the shell
reads its own `SAIRIOS_SHELL_BIND_HOST` so that "expose the shell" and "expose the
unauthenticated broker" are no longer the same instruction. The original remote-access
documentation told people to set the shared one.

**Revocation had to reach requests already in flight.** A grant revoked between propose and
execute leaves the policy at `ask`, not `deny`, so the execution-time re-check — which only
looked for `deny` — let the request run on an authorisation that no longer existed. Requests
carry `userDecided` now: one a human explicitly allowed still runs, one that policy allowed on
its own does not. Without that, "grants are revocable" was untrue for anything mid-flight.

**`SameSite=Strict` is doing the CSRF work.** The state-changing service routes behind this
door have no CSRF tokens of their own, and adding them to three services would be a large
change for a threat the cookie attribute already covers. Worth knowing if that attribute is
ever relaxed.

**This is not encryption, and the code cannot enforce that it is used with any.** A bearer
token over plain http on an untrusted network is readable in transit. `SAIRIOS_BEHIND_TLS`
marks the cookie `Secure` but nothing verifies that TLS actually terminates in front. The
recommendation — tunnel or overlay network, both of which encrypt and keep the services on
loopback — is in [docs/REMOTE.md](../REMOTE.md) rather than in an assertion.

**It is single-user.** Whoever holds the token is the user. No accounts, no per-context
scoping, no expiry short of a restart with a new value. Honest for a personal operating
environment, wrong for a shared one, and the thing to revisit first if SairiOS ever has two
users.

**It does not defend against local code execution.** An agent already on the machine reaches
7801-7803 directly and never passes this door. That is consistent with the stated threat model
— the local machine is trusted — but it means this closes the network edge and nothing else.

**The interlock only covers `serve.mjs`.** `vite --host` will happily serve the same built shell
on a routable address with no token, because the dev server never calls `resolveAccess`. That
is a development tool and not how SairiOS is deployed, but "no override flag" is a statement
about the production server, not about every way the bundle can be served.

**Revocation exists without a UI.** `brokerApi.revoke` is wired and nothing in the desktop
calls it, so withdrawing a grant currently means an HTTP request. The endpoint had to come
first because it is the precondition remote access depends on; the surface is a smaller,
separate job, and SECURITY.md's limitation 10 now says so rather than claiming revocation is
impossible.

**Refusing an empty filter is deliberate.** `revoke({})` is an error rather than "revoke
everything", because a blanket clear triggered by an accidentally-`undefined` argument would
destroy the one table a user cannot reconstruct from memory.
