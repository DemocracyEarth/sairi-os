# 0011. Serve the services from the shell's origin under path prefixes

- Status: Accepted
- Date: 2026-08-07
- Deciders: SairiOS founding engineering

## Context

The shell is a static bundle on port 7800. Until now it addressed the three services by
absolute origin — `http://127.0.0.1:7801`, `:7802`, `:7803` — with those origins baked into
the bundle at build time by `import.meta.env`, and the same three origins listed again in the
Content Security Policy's `connect-src`, also at build time.

Four origins, and the browser talking to all four, meant the deployment's port numbers were
compiled into two separate artifacts. That cost three things:

- **CORS.** Every service carries a loopback allow-list naming the shell's origin, because
  every call from the page is cross-origin.
- **A four-port tunnel.** `tunnel.sh` forwarded 7800-7803, and its header comment explained at
  length that forwarding only 7800 produced "a desktop with no data and a console full of
  connection errors — which reads like a broken build rather than a missing tunnel".
- **No path to remote access.** Serving the shell from anywhere but the user's own machine
  fails twice before CORS is even consulted: the bundle calls `127.0.0.1`, which is now the
  viewer's laptop rather than the VM, and the CSP — a build-time `<meta>` tag listing six
  hardcoded loopback origins — blocks the call regardless.

The alternatives were: keep absolute origins and make them configurable at runtime; give each
service a subdomain; or collapse everything onto one origin.

## Decision

The shell addresses the services through same-origin path prefixes — `/ctx`, `/bridge`,
`/broker` — and whatever serves the shell proxies them onward. `serve.mjs` does this in
production via [apps/shell/proxy.mjs](../../apps/shell/proxy.mjs); Vite's `server.proxy` does
it in development.

`connect-src` becomes `'self'` and nothing else.

The proxy is deliberately not general. Its route table is fixed at module load, its upstream
host is the constant `127.0.0.1`, and nothing about the destination is derived from the
request. A proxy that reads its target from a path segment or a header is a server-side
request forgery primitive, and this one runs in front of the permission broker.

## Consequences

**The CSP got stricter, not looser.** It no longer names a single port, so it cannot go stale
against a deployment that moved one — the failure mode that produced
[ADR 0009](0009-precompiled-schema-validator.md)'s silent blank page.

**CORS stops applying on the browser path.** Same-origin requests are not checked. The
allow-lists remain for a dev shell pointed at services directly through the `VITE_*`
overrides, which is still supported and still cross-origin.

**The tunnel forwards one port.** `tunnel.sh` lost three `-L` flags and the paragraph
apologising for them.

**Nothing may buffer.** `bridgeApi.runIntention` consumes NDJSON incrementally so the shell can
show an agent working rather than a spinner. A proxy that accumulates the response turns a
visible run into a frozen screen for the duration of model inference. `proxy.mjs` pipes in
both directions and `proxy.test.ts` asserts it by deadlock: the stub upstream refuses to send
its second frame until the client has received the first, so a buffering implementation times
out instead of quietly passing.

**The shell process now makes outbound connections.** Previously the browser opened every
service connection and the shell process opened none; `sairios-shell.service` said so in a
comment. They are all loopback, which its existing `IPAddressAllow=localhost` already permits,
and the comment has been corrected.

**One route table, written twice.** Vite cannot import the runtime proxy, and the runtime proxy
must stay dependency-free because the guest installs with `npm ci --omit=dev`. `proxy.test.ts`
asserts the two agree, and that `api.ts` uses the same prefixes, so they cannot drift silently.

**This is not authentication, and must not be mistaken for it.** Collapsing four origins into
one makes a single authenticated front door _possible_ — that is the point, and it is the
prerequisite for any remote access. It adds no authentication of its own. The services still
have none, so this still binds to loopback. Anyone who can reach the broker can propose a
permission request, approve it, and execute it, because all three phases are unauthenticated
HTTP. Remote access requires fixing that first; see [SECURITY.md](../../SECURITY.md).
