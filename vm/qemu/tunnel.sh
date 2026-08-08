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
# One port, not four
# ---------------------------------------------------------------------------
# This script used to forward 7800-7803, because the page was served from 7800
# but called the context service on 7801, the agent bridge on 7802 and the
# permission broker on 7803 as separate origins. Forwarding one port produced a
# desktop with no data and a console full of connection errors, which reads like
# a broken build rather than a missing tunnel.
#
# The shell now reaches those services through same-origin prefixes — /ctx,
# /bridge and /broker — which the guest's own `serve.mjs` proxies onward to
# loopback inside the guest. So everything arrives on 7800 and there is nothing
# else to forward. See apps/shell/proxy.mjs.
#
# QEMU's own `hostfwd` still cannot do this: it forwards to the guest's DHCP
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

# Refuse rather than half-work: the forward would fail and ssh -N would sit
# there looking connected, so the symptom is a page that never loads.
if lsof -ti:7800 >/dev/null 2>&1; then
	printf 'tunnel.sh: port 7800 is already in use on this machine.\n' >&2
	printf '  Stop whatever holds it (often a local `make dev`) and try again.\n' >&2
	exit 1
fi

printf '==> Tunnelling guest 7800 to this machine\n'
printf '    shell     http://127.0.0.1:7800/#/os   (Sairi OS)\n'
printf '              http://127.0.0.1:7800/       (v0 desktop)\n'
printf '    services  same origin, under /ctx /bridge /broker\n'
printf '\n'
printf '    Paste works here. Ctrl-C to close the tunnel.\n'
printf '\n'

exec ssh -N \
	-L 7800:127.0.0.1:7800 \
	-p "$SSH_PORT" -i "$KEY" \
	-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
	-o ExitOnForwardFailure=yes \
	"debian@$HOST"
