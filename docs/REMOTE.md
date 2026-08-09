# Reaching SairiOS from another machine

SairiOS's shell is a web application, and the VM only runs a kiosk browser to
display it. So using a cloud instance from your laptop does **not** need pixel
streaming — no VNC, no RDP, no WebRTC. You serve the app.

This document is the operational half of
[ADR 0013](adr/0013-authenticated-front-door.md). Read
[SECURITY.md](../SECURITY.md) first if you are about to expose anything.

## The one rule

**The services have no authentication of their own.** They bind loopback and
trust the local user. Everything below exists to make sure that assumption keeps
holding once a network path exists.

Since [ADR 0011](adr/0011-same-origin-service-proxy.md) the shell process is the
only thing that needs to be reachable: it serves the bundle and proxies `/ctx`,
`/bridge` and `/broker` to loopback. One process, one origin, one door.

The door is enforced rather than advised. **Binding anywhere other than loopback
with no access token is a startup error**, with no override flag:

```
sairios-shell: refusing to bind 0.0.0.0 with no access token.
```

## Option 1 — a tunnel (recommended, and already built)

Nothing is exposed. SSH is the authentication, the services stay on loopback,
and no token is needed because no network path exists.

```bash
./vm/qemu/tunnel.sh
```

Then open `http://127.0.0.1:7800/#/os`. One port, since ADR 0011.

For a cloud instance rather than a local VM, the same shape with your own host:

```bash
ssh -N -L 7800:127.0.0.1:7800 user@your-vm
```

This is the right answer for one person and one machine, which is the situation
almost every SairiOS user is in.

## Option 2 — an overlay network

When you want it reachable from several of your own devices without typing an
SSH command each time. The services still bind loopback; the overlay dials them
exactly as the kiosk browser does, and you get TLS and device-key authentication
without managing certificates.

```bash
tailscale serve --bg 7800
```

Write the ACLs at the same time, not later. A tailnet is a device boundary: with
no ACLs, every device you own has unauthenticated access to your contexts.

Set a token anyway. Defence in depth costs one environment variable, and it
means a misconfigured ACL is not immediately a compromised permission broker.

## Option 3 — binding to a network interface

Only with a token, only behind TLS, and only when the two options above do not
fit.

```bash
# Generate once. Store it in your password manager, not in a file in the repo.
openssl rand -hex 32
```

On the machine running SairiOS:

```bash
SAIRIOS_SHELL_BIND_HOST=0.0.0.0 SAIRIOS_ACCESS_TOKEN=<the token> SAIRIOS_BEHIND_TLS=true \
  node apps/shell/serve.mjs
```

`SAIRIOS_SHELL_BIND_HOST`, **not** `SAIRIOS_BIND_HOST`. The latter is shared by
the three services, which have no front door — setting it would expose the
permission broker itself, which is the opposite of what this page is for. The
services now refuse to start off loopback rather than warning, so the mistake
fails loudly instead of quietly, but the variable to reach for is the shell's
own.

In the VM the shell unit reads `/home/sairi/.config/sairios/env`. Put the token
there and nowhere else: `#` starts a comment in that format, and values with
special characters need quoting.

```bash
install -m 600 -o sairi -g sairi /dev/null /home/sairi/.config/sairios/env
printf 'SAIRIOS_ACCESS_TOKEN=%s\n' "$(openssl rand -hex 32)" \
  >> /home/sairi/.config/sairios/env
```

Do **not** put it in `/etc/sairios/session.env`. That file is read by the
graphical session unit, is not read by the shell, and is not treated as a secret
store.

Browsing to any path returns a sign-in page; the token is exchanged once for an
`HttpOnly; SameSite=Strict` cookie.

`SAIRIOS_BEHIND_TLS=true` marks that cookie `Secure`, and you should set it
whenever something in front terminates TLS. **A bearer token over plain http on
an untrusted network is readable in transit** — this design assumes the
transport encrypts, and does not do it itself.

## What is deliberately not recommended

**Cloudflare Tunnel**, despite having the best turnkey authentication here. It
terminates TLS at the edge, so a third party reads every context, file operation
and permission decision in plaintext. A project that simulates `network.fetch`
specifically so no egress happens on an agent's behalf should not seat a
commercial intermediary in its data path. If you want the SSO, run an OIDC
provider behind forward-auth on your own proxy.

**Pixel streaming** — noVNC, KasmVNC, x11vnc — is inapplicable anyway: this is a
Wayland session under weston, and those need an X server. Even where it works it
encodes a browser rendering a React app and ships it to a browser that could
have rendered the app itself.

## What is still missing

`SAIRIOS_ACCESS_TOKEN` is a bearer token for a **single-user** machine: whoever
holds it is the user. There are no accounts, no per-context scoping, and no
expiry short of restarting with a new value. That is honest for a personal
operating environment and wrong for a shared one.

It also does not defend against something already running on the box. An agent
with code execution reaches 7801-7803 directly and never passes this door.
SECURITY.md's threat model says the local machine is trusted; this protects the
network edge, which is the boundary remote access actually creates.
