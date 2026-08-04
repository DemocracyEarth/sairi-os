#!/usr/bin/env bash
#
# Connect the running guest to a model provider, from the host.
#
# The problem this solves: QEMU's default display has no clipboard channel, so
# there is nothing to paste into. Typing a forty-character API key into a kiosk
# by hand is not a setup flow, it is a punishment.
#
# So do not type it into the VM at all. This drives the SAME endpoint the wizard
# drives — POST /setup on the agent bridge — over an SSH tunnel, which means the
# real code path runs: shape validation, the 0600 write, and
# `openclaw onboard --secret-input-mode ref`. Nothing here is a shortcut around
# the design; it is the same door, opened from outside.
#
# ---------------------------------------------------------------------------
# Why the key is NOT baked into the image or the cloud-init seed
# ---------------------------------------------------------------------------
# It is the obvious idea and it is the wrong one. CLAUDE.md states the rule
# without exceptions: no credential in source, tests, fixtures, image layers,
# Dockerfiles or cloud-init files. A key in `user-data` lands in vm/out/seed.iso
# — an unencrypted file that outlives the boot, gets copied when the image is
# copied, and is readable by anything on the host. The 0600 file inside the
# guest is strictly better, and this script is how the key gets there.
#
# ---------------------------------------------------------------------------
# What this does with the key
# ---------------------------------------------------------------------------
#   - reads it from a hidden prompt or an environment variable
#   - never as a command-line argument, because `ps` shows argv to every user
#   - pipes it to curl on stdin, so it is not in curl's argv either
#   - never writes it to a file on the host
#   - never prints it, and disables shell tracing around it
#
# Usage:
#   ./vm/qemu/connect-model.sh                          # prompts, hidden
#   SAIRIOS_PROVIDER_KEY=sk-ant-… ./vm/qemu/connect-model.sh
#   ./vm/qemu/connect-model.sh --provider openai --model openai/gpt-5
#   ./vm/qemu/connect-model.sh --status                 # just report

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

KEY="$REPO_ROOT/vm/out/sairios_dev_key"
SSH_PORT=22022
HOST=127.0.0.1
PROVIDER=anthropic
MODEL=""
STATUS_ONLY=0
# A high, unlikely-to-collide local port: the caller may already be running the
# shell or another guest on the usual ones.
LOCAL_PORT=17802

while [ $# -gt 0 ]; do
	case "$1" in
	--key) KEY="${2:?--key needs a path}" && shift 2 ;;
	--port) SSH_PORT="${2:?--port needs a value}" && shift 2 ;;
	--host) HOST="${2:?--host needs a value}" && shift 2 ;;
	--provider) PROVIDER="${2:?--provider needs a value}" && shift 2 ;;
	--model) MODEL="${2:?--model needs a value}" && shift 2 ;;
	--status) STATUS_ONLY=1 && shift ;;
	--help | -h)
		sed -n '2,40p' "$0"
		exit 0
		;;
	# Deliberately absent: --api-key. A key on the command line is visible in
	# `ps` to every user on the machine and lands in the shell history file.
	--api-key | --api-key=*)
		printf 'connect-model.sh: there is no --api-key flag, on purpose.\n' >&2
		printf '  argv is world-readable through ps, and this would end up in your\n' >&2
		printf '  shell history. Use the prompt, or SAIRIOS_PROVIDER_KEY=… instead.\n' >&2
		exit 2
		;;
	*)
		printf 'connect-model.sh: unknown option %s\n' "$1" >&2
		exit 1
		;;
	esac
done

[ -f "$KEY" ] || {
	printf 'connect-model.sh: no SSH key at %s\n' "$KEY" >&2
	printf '  Build the image with --ssh-key so the guest accepts one.\n' >&2
	exit 1
}

command -v curl >/dev/null || {
	printf 'connect-model.sh: curl is required.\n' >&2
	exit 1
}

say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------------------
# Tunnel
#
# The guest's services bind 127.0.0.1 INSIDE the guest, so QEMU's hostfwd cannot
# reach them — it forwards to the guest's DHCP address, where nothing listens.
# An SSH tunnel terminates inside the guest and therefore does reach loopback.
# This is the same reason --forward-shell does not work on its own.
# ---------------------------------------------------------------------------
TUNNEL_PID=""
cleanup() {
	[ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say "==> Opening a tunnel to the guest's agent bridge"
ssh -N -L "${LOCAL_PORT}:127.0.0.1:7802" \
	-p "$SSH_PORT" -i "$KEY" \
	-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
	-o ExitOnForwardFailure=yes \
	"debian@$HOST" &
TUNNEL_PID=$!

BRIDGE="http://127.0.0.1:${LOCAL_PORT}"
for _ in $(seq 1 25); do
	curl -sS -o /dev/null --max-time 2 "${BRIDGE}/setup" 2>/dev/null && break
	sleep 0.4
done

STATUS="$(curl -sS --max-time 8 "${BRIDGE}/setup" 2>/dev/null || true)"
[ -n "$STATUS" ] || {
	printf '\nconnect-model.sh: the guest agent bridge did not answer.\n' >&2
	printf '  Is the VM running, and is sairios-agent-bridge active?\n' >&2
	printf '    ssh -p %s -i %s debian@%s systemctl status sairios-agent-bridge\n' \
		"$SSH_PORT" "$KEY" "$HOST" >&2
	exit 1
}

report() {
	printf '%s' "$1" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const s = JSON.parse(d);
  // Never prints a key: GET /setup has no field that could carry one.
  console.log("    configured : " + s.configured);
  console.log("    provider   : " + (s.provider ?? "-") + (s.model ? " · " + s.model : ""));
  console.log("    openclaw   : " + (s.openclawInstalled ? s.openclawVersion : "NOT INSTALLED"));
  console.log("    gateway    : " + s.gatewayUrl);
  if (!s.openclawInstalled) process.exitCode = 3;
});'
}

say ""
say "==> Guest status"
report "$STATUS"

if [ "$STATUS_ONLY" -eq 1 ]; then
	exit 0
fi

# Pick a default model for the chosen provider from what the guest actually
# offers, rather than hardcoding a list that can drift from the service.
if [ -z "$MODEL" ]; then
	MODEL="$(printf '%s' "$STATUS" | PROVIDER="$PROVIDER" node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const s = JSON.parse(d);
  const p = s.providers.find((x) => x.id === process.env.PROVIDER);
  if (!p) {
    console.error("unknown provider: " + process.env.PROVIDER +
      " (guest offers: " + s.providers.map((x) => x.id).join(", ") + ")");
    process.exit(1);
  }
  process.stdout.write(p.models[0].id);
});')"
fi

say ""
say "==> Connecting ${PROVIDER} · ${MODEL}"

# ---------------------------------------------------------------------------
# The key. Everything below is written to keep it out of argv, off the host
# disk, and out of the terminal.
# ---------------------------------------------------------------------------
set +x # in case the caller exported an xtrace
if [ -n "${SAIRIOS_PROVIDER_KEY:-}" ]; then
	PROVIDER_KEY="$SAIRIOS_PROVIDER_KEY"
	say "    using SAIRIOS_PROVIDER_KEY from the environment"
elif [ -t 0 ]; then
	printf '    paste your %s key (input hidden): ' "$PROVIDER"
	# -s: no echo. Reading into a variable rather than a file means it never
	# touches the host filesystem.
	read -rs PROVIDER_KEY
	printf '\n'
else
	# No terminal to prompt on. Without this branch `read` hits EOF, returns
	# non-zero, and `set -e` kills the script with no output at all — which is
	# the worst way to tell someone their automation is missing an input.
	printf '\n'
	printf 'connect-model.sh: no terminal to prompt on, and SAIRIOS_PROVIDER_KEY is not set.\n' >&2
	printf '\n' >&2
	printf '  Run it from a terminal:\n' >&2
	printf '      make vm-connect\n' >&2
	printf '\n' >&2
	printf '  Or supply the key through the environment, which is what CI and\n' >&2
	printf '  scripts should do:\n' >&2
	printf '      SAIRIOS_PROVIDER_KEY="$(cat ~/.anthropic-key)" make vm-connect\n' >&2
	printf '\n' >&2
	printf '  Nothing was changed on the guest.\n' >&2
	exit 1
fi

[ -n "${PROVIDER_KEY:-}" ] || {
	printf 'connect-model.sh: no key given, nothing was changed.\n' >&2
	exit 1
}

# Body is built in memory and piped on stdin. `--data @-` keeps it out of argv,
# where `ps` would otherwise show it.
RESPONSE="$(
	PROVIDER="$PROVIDER" MODEL="$MODEL" PROVIDER_KEY="$PROVIDER_KEY" node -e '
process.stdout.write(JSON.stringify({
  provider: process.env.PROVIDER,
  model: process.env.MODEL,
  apiKey: process.env.PROVIDER_KEY,
}));' | curl -sS --max-time 120 -X POST "${BRIDGE}/setup" \
		-H 'content-type: application/json' \
		--data @- 2>&1 || true
)"
unset PROVIDER_KEY SAIRIOS_PROVIDER_KEY

OK="$(printf '%s' "$RESPONSE" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  try {
    const r = JSON.parse(d);
    if (r.error) { console.error("    " + r.error.code + ": " + r.error.message); process.stdout.write("no"); }
    else process.stdout.write(r.configured ? "yes" : "no");
  } catch { console.error("    unreadable response from the guest"); process.stdout.write("no"); }
});' 2>&1 || true)"

case "$OK" in
*yes*)
	say ""
	say "==> Connected"
	report "$(curl -sS --max-time 8 "${BRIDGE}/setup")"
	say ""
	say "    The key is now in one 0600 file inside the guest. It was never"
	say "    written to this machine's disk and never appeared in argv."
	say "    The gateway starts on its own: sairios-openclaw.path is watching"
	say "    for exactly that file."
	;;
*)
	say ""
	printf 'connect-model.sh: the guest refused the configuration. Nothing was stored.\n' >&2
	printf '%s\n' "$OK" | grep -v '^no$' >&2 || true
	exit 1
	;;
esac
