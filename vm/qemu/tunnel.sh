#!/usr/bin/env bash
#
# Bring the guest's desktop to the host browser.
#
# Two reasons to want this, and the second is the one that keeps coming up:
#
#   1. The QEMU window has no clipboard channel, so you cannot paste anything
#      into the guest — an API key, a URL, a file path. In the host browser you
#      can, because it is just a browser.
#   2. Devtools. The guest runs cog, which has none.
#
# ---------------------------------------------------------------------------
# Why all four ports, and not just 7800
# ---------------------------------------------------------------------------
# Forwarding only the shell gets you a page where every request fails. The shell
# is served from 7800 but talks to the context service on 7801, the agent bridge
# on 7802 and the permission broker on 7803, and its CORS allowlist names those
# exact loopback origins. Tunnel one port and you get a desktop with no data and
# a console full of connection errors — which reads like a broken build rather
# than a missing tunnel.
#
# QEMU's own `hostfwd` cannot do this at all: it forwards to the guest's DHCP
# address (10.0.2.15), and every SairiOS service binds 127.0.0.1 inside the
# guest on purpose. An SSH tunnel terminates inside the guest, so it reaches
# loopback. That is why `--forward-shell` prints a warning instead of working.
#
# Usage:
#   ./vm/qemu/tunnel.sh          # then open http://127.0.0.1:7800/#/os
#   ./vm/qemu/tunnel.sh --port 22022 --key vm/out/sairios_dev_key

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

KEY="$REPO_ROOT/vm/out/sairios_dev_key"
SSH_PORT=22022
HOST=127.0.0.1

while [ $# -gt 0 ]; do
	case "$1" in
	--key) KEY="${2:?--key needs a path}" && shift 2 ;;
	--port) SSH_PORT="${2:?--port needs a value}" && shift 2 ;;
	--host) HOST="${2:?--host needs a value}" && shift 2 ;;
	--help | -h)
		sed -n '2,30p' "$0"
		exit 0
		;;
	*)
		printf 'tunnel.sh: unknown option %s\n' "$1" >&2
		exit 1
		;;
	esac
done

[ -f "$KEY" ] || {
	printf 'tunnel.sh: no SSH key at %s\n' "$KEY" >&2
	exit 1
}

# Refuse rather than half-work: a port already in use would silently leave one
# service unreachable, and the symptom (a desktop with some panels empty) is
# much harder to read than this message.
BUSY=0
for port in 7800 7801 7802 7803; do
	if lsof -ti:"$port" >/dev/null 2>&1; then
		printf 'tunnel.sh: port %s is already in use on this machine.\n' "$port" >&2
		BUSY=1
	fi
done
[ "$BUSY" -eq 0 ] || {
	printf '  Stop whatever holds it (often a local `make dev`) and try again.\n' >&2
	exit 1
}

printf '==> Tunnelling guest 7800-7803 to this machine\n'
printf '    shell     http://127.0.0.1:7800/#/os   (Sairi OS)\n'
printf '              http://127.0.0.1:7800/       (v0 desktop)\n'
printf '    services  7801 contexts · 7802 bridge · 7803 broker\n'
printf '\n'
printf '    Paste works here. Ctrl-C to close the tunnel.\n'
printf '\n'

exec ssh -N \
	-L 7800:127.0.0.1:7800 \
	-L 7801:127.0.0.1:7801 \
	-L 7802:127.0.0.1:7802 \
	-L 7803:127.0.0.1:7803 \
	-p "$SSH_PORT" -i "$KEY" \
	-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
	-o ExitOnForwardFailure=yes \
	"debian@$HOST"
