#!/usr/bin/env bash
#
# SairiOS session launcher.
#
# Installed as (or exec'd by) /usr/local/bin/sairios-session and started either by
# sairios-session.service or by a display manager reading sairios.desktop.
#
# Responsibilities, in order:
#   1. Establish that we have a usable Wayland-capable environment.
#   2. Wait, with a bounded timeout, for the SairiOS shell to answer on its port.
#   3. exec `cage -- cog <url>`.
#   4. If any of that fails, print something a human can act on, on the actual screen.
#
# It does NOT start the SairiOS services. Those are systemd user units. If they are not
# running, this script's job is to say so clearly, not to paper over it.
#
# Verification status: this HAS been executed in the VM. cage starts, cog loads the
# shell from http://127.0.0.1:7800 and reports "Loaded successfully". What has NOT
# been seen is pixels: see the software-rendering block below and vm/README.md.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (all overridable from the environment / EnvironmentFile)
# ---------------------------------------------------------------------------
# The VM boots into Sairi OS — the context-native surface at #/os — not the v0
# desktop. Both are served by the same shell; the hash decides which mounts.
#
# The v0 desktop stays reachable at http://127.0.0.1:7800/ for anyone who wants
# it, and overriding this variable in the EnvironmentFile switches the machine
# back without a rebuild.
SAIRIOS_SHELL_URL="${SAIRIOS_SHELL_URL:-http://127.0.0.1:7800/#/os}"
SAIRIOS_SHELL_HOST="${SAIRIOS_SHELL_HOST:-127.0.0.1}"
SAIRIOS_SHELL_PORT="${SAIRIOS_SHELL_PORT:-7800}"
# Total seconds to wait for the shell port. Generous: on first boot the shell unit may be
# waiting on npm resolving a workspace, and a cold VM is slow.
SAIRIOS_SHELL_WAIT_SECONDS="${SAIRIOS_SHELL_WAIT_SECONDS:-120}"
SAIRIOS_SHELL_POLL_INTERVAL="${SAIRIOS_SHELL_POLL_INTERVAL:-1}"
# Where to shout when things go wrong. The journal is not enough: a user staring at a
# black screen needs the text on the screen.
SAIRIOS_SESSION_TTY="${SAIRIOS_SESSION_TTY:-/dev/tty1}"
# Which compositor runs the session. See "compositor choice" below for why weston
# is the default and cage is not.
SAIRIOS_COMPOSITOR="${SAIRIOS_COMPOSITOR:-weston}"
WESTON_BIN="${WESTON_BIN:-weston}"
CAGE_BIN="${CAGE_BIN:-cage}"
COG_BIN="${COG_BIN:-cog}"

PROG="sairios-session"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

log() {
	printf '%s: %s\n' "$PROG" "$*" >&2
}

RULE='====================================================================='

# Format a legible block once, then emit it to stderr (which the journal captures) and,
# if it is writable, to the console as well. The TTY not being writable is a normal
# condition when this script runs under a display manager, so it must never be fatal.
banner() {
	local line
	local text=""

	text="${text}
${RULE}
  SairiOS session could not start
${RULE}"
	for line in "$@"; do
		text="${text}
  ${line}"
	done
	text="${text}
${RULE}
"

	printf '%s\n' "$text" >&2

	if [ -w "$SAIRIOS_SESSION_TTY" ]; then
		printf '%s\n' "$text" >>"$SAIRIOS_SESSION_TTY" 2>/dev/null || true
	fi
}

die() {
	banner "$@"
	exit 1
}

have() {
	command -v "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# 1. Environment
# ---------------------------------------------------------------------------

# XDG_RUNTIME_DIR is normally set by pam_systemd when the session opens. If it is not,
# derive the conventional path and check it, rather than inventing a directory: a
# missing /run/user/<uid> means logind never registered a session, and creating a
# lookalike directory would only hide that.
if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
	XDG_RUNTIME_DIR="/run/user/$(id -u)"
	export XDG_RUNTIME_DIR
	log "XDG_RUNTIME_DIR was unset; assuming $XDG_RUNTIME_DIR"
fi

if [ ! -d "$XDG_RUNTIME_DIR" ]; then
	die \
		"XDG_RUNTIME_DIR ($XDG_RUNTIME_DIR) does not exist." \
		"" \
		"This means logind never opened a session for this user." \
		"Check that sairios-session.service has PAMName=login, and that" \
		"systemd-logind is running:" \
		"" \
		"    systemctl status systemd-logind" \
		"    loginctl list-sessions"
fi

# cage creates the Wayland socket. If WAYLAND_DISPLAY is already set we are almost
# certainly nested inside another compositor, which is a legitimate way to test but not
# how the kiosk is meant to run. Say so and continue.
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
	log "WAYLAND_DISPLAY is already set ($WAYLAND_DISPLAY); running nested."
else
	# cage will export this for its children. Setting the expectation here documents the
	# contract and lets a caller override the socket name.
	export SAIRIOS_EXPECTED_WAYLAND_DISPLAY="${SAIRIOS_EXPECTED_WAYLAND_DISPLAY:-wayland-0}"
fi

export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"
export XDG_SESSION_DESKTOP="${XDG_SESSION_DESKTOP:-sairios}"
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-SairiOS}"
# Ask GTK-based and Qt-based helpers to prefer Wayland rather than falling back to X11,
# which is not present.
# --- software rendering -----------------------------------------------------
# Defaults for a guest with no working GL, which is the normal case under QEMU:
# a plain virtio-gpu with no virglrenderer gives no GL, EGL fails to initialise
# and mesa falls back to kms_swrast. Observed in the VM:
#
#   libEGL warning: egl: failed to create dri2 screen
#   [EGL] eglInitialize: EGL_NOT_INITIALIZED "DRI2: failed to create screen"
#
# WLR_RENDERER=pixman makes cage render in software rather than sitting on a
# broken EGL, and disabling WebKit's compositing keeps cog off the GL path.
#
# These are defaults, not decisions: on hardware with a real GPU, export them
# beforehand as empty or set WLR_RENDERER=gles2 to get accelerated rendering.
export WLR_RENDERER="${WLR_RENDERER:-pixman}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"

export GDK_BACKEND="${GDK_BACKEND:-wayland}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-wayland}"
export MOZ_ENABLE_WAYLAND=1
# cog's platform plugin. `wl` is the Wayland backend; without this cog may pick a
# different platform and fail with a message that does not mention Wayland at all.
export COG_PLATFORM_NAME="${COG_PLATFORM_NAME:-wl}"

# ---------------------------------------------------------------------------
# 2. Binaries
# ---------------------------------------------------------------------------

if [ "$SAIRIOS_COMPOSITOR" = weston ] && ! have "$WESTON_BIN"; then
	fail \
		"The Wayland compositor '$WESTON_BIN' is not installed." \
		"    sudo apt-get install -y weston" \
		"Or set SAIRIOS_COMPOSITOR=cage to use cage (which needs working GL)."
fi

if [ "$SAIRIOS_COMPOSITOR" = cage ] && ! have "$CAGE_BIN"; then
	die \
		"The Wayland kiosk compositor '$CAGE_BIN' is not installed." \
		"" \
		"    sudo apt-get install -y cage"
fi

if ! have "$COG_BIN"; then
	die \
		"The kiosk browser '$COG_BIN' is not installed." \
		"" \
		"    sudo apt-get install -y cog"
fi

# A DRM device is what cage actually needs. Checking for it turns a black screen into a
# sentence.
if [ ! -e /dev/dri/card0 ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
	die \
		"No DRM device found at /dev/dri/card0." \
		"" \
		"cage has nothing to draw on. In a VM this usually means the guest has no" \
		"virtio-gpu device. Check that the VM was started with:" \
		"" \
		"    -device virtio-gpu-pci" \
		"" \
		"and that the user is in the 'video' and 'render' groups:" \
		"" \
		"    id -nG"
fi

# ---------------------------------------------------------------------------
# 3. Wait for the shell
# ---------------------------------------------------------------------------

# Returns 0 when something accepts a TCP connection on host:port.
# Prefers bash's /dev/tcp because it needs no packages; falls back to curl, then nc.
port_is_open() {
	local host="$1" port="$2"

	# bash opens /dev/tcp/<host>/<port> natively. Running it in a subshell means the
	# descriptor is closed for us when the subshell exits.
	if (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
		return 0
	fi

	if have curl; then
		curl --silent --show-error --fail --max-time 2 \
			--output /dev/null "http://${host}:${port}/" >/dev/null 2>&1 && return 0
	fi

	if have nc; then
		nc -z -w 2 "$host" "$port" >/dev/null 2>&1 && return 0
	fi

	return 1
}

wait_for_shell() {
	local deadline now elapsed=0
	now="$(date +%s)"
	deadline=$((now + SAIRIOS_SHELL_WAIT_SECONDS))

	log "waiting up to ${SAIRIOS_SHELL_WAIT_SECONDS}s for the shell on ${SAIRIOS_SHELL_HOST}:${SAIRIOS_SHELL_PORT}"

	while :; do
		if port_is_open "$SAIRIOS_SHELL_HOST" "$SAIRIOS_SHELL_PORT"; then
			log "shell is answering after ${elapsed}s"
			return 0
		fi

		now="$(date +%s)"
		if [ "$now" -ge "$deadline" ]; then
			return 1
		fi

		# Progress on the console every 10 seconds so a slow first boot does not look
		# like a hang.
		if [ $((elapsed % 10)) -eq 0 ] && [ "$elapsed" -gt 0 ]; then
			printf 'SairiOS: waiting for the shell on port %s (%ss elapsed)\n' \
				"$SAIRIOS_SHELL_PORT" "$elapsed" >>"$SAIRIOS_SESSION_TTY" 2>/dev/null || true
		fi

		sleep "$SAIRIOS_SHELL_POLL_INTERVAL"
		elapsed=$((elapsed + SAIRIOS_SHELL_POLL_INTERVAL))
	done
}

if ! wait_for_shell; then
	# Collect whatever diagnosis we can before giving up, so the banner is actionable.
	shell_state="unknown"
	if have systemctl; then
		shell_state="$(systemctl --user is-active sairios-shell.service 2>/dev/null || true)"
		[ -n "$shell_state" ] || shell_state="unknown"
	fi

	die \
		"The SairiOS shell never answered on ${SAIRIOS_SHELL_HOST}:${SAIRIOS_SHELL_PORT}" \
		"after ${SAIRIOS_SHELL_WAIT_SECONDS} seconds." \
		"" \
		"sairios-shell.service state: ${shell_state}" \
		"" \
		"Triage, as the user that owns the services (sairi):" \
		"" \
		"    systemctl --user status sairios-shell.service" \
		"    journalctl --user -u sairios-shell.service -n 100 --no-pager" \
		"    ls /opt/sairios/apps/shell/dist" \
		"" \
		"Most common causes:" \
		"  - /opt/sairios is empty; the product tree was never delivered to the VM." \
		"  - the shell was never built (npm run build at /opt/sairios)." \
		"  - the user manager is not running because lingering is off:" \
		"        loginctl enable-linger sairi" \
		"" \
		"Switch to another VT with Ctrl-Alt-F2 to work, or read the first-boot report:" \
		"    cat /var/log/sairios-firstboot.log"
fi

# ---------------------------------------------------------------------------
# 4. Start the session
# ---------------------------------------------------------------------------

# --- compositor choice ------------------------------------------------------
# weston with kiosk-shell, not cage, and the reason is measured rather than
# preferred.
#
# cage cannot present without working GL. Under QEMU the guest has a plain
# virtio-gpu with no virglrenderer, EGL fails to initialise, and cage's wlroots
# falls back to software but then cannot scan out:
#
#   [ERROR] [types/output/output.c:656] Basic output test failed for Virtual-1
#
# It gets far enough to load the product - cog reports "Loaded successfully" -
# and still shows nothing. weston's DRM backend has a supported software path
# (--use-pixman) that does present on the same hardware, confirmed by taking a
# screenshot inside the guest.
#
# kiosk-shell gives what cage gave: one fullscreen client, no panel, no
# decorations. Set SAIRIOS_COMPOSITOR=cage on a machine with real GL if you
# prefer the smaller compositor.
if [ "$SAIRIOS_COMPOSITOR" = cage ]; then
	log "starting: $CAGE_BIN -- $COG_BIN $SAIRIOS_SHELL_URL"
	exec "$CAGE_BIN" -- "$COG_BIN" "$SAIRIOS_SHELL_URL"
fi

log "starting: $WESTON_BIN (kiosk-shell, pixman) with $COG_BIN $SAIRIOS_SHELL_URL"

# weston does not launch a client itself, so cog is started once the compositor
# socket appears, and is torn down with the session.
WAYLAND_SOCKET_NAME="${WAYLAND_SOCKET_NAME:-wayland-1}"
(
	for _ in $(seq 1 60); do
		[ -S "${XDG_RUNTIME_DIR}/${WAYLAND_SOCKET_NAME}" ] && break
		sleep 0.2
	done
	WAYLAND_DISPLAY="$WAYLAND_SOCKET_NAME" exec "$COG_BIN" "$SAIRIOS_SHELL_URL"
) &
COG_PID=$!
trap 'kill "$COG_PID" 2>/dev/null || true' EXIT INT TERM

# weston --debug enables the screenshot protocol, which is how you get a picture
# of what the machine is actually showing without a camera. It is OFF by default
# and must stay that way: the protocol lets any client on the socket capture the
# screen, which is a capture of whatever context is open.
#
#   sudo systemctl set-environment SAIRIOS_SESSION_DEBUG=1
#   sudo systemctl restart sairios-session
#   sudo -u sairi env XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 \
#       weston-screenshooter
#
# Unset it and restart when you are done.
WESTON_ARGS="--backend=drm-backend.so --shell=kiosk-shell.so --use-pixman --idle-time=0"
if [ "${SAIRIOS_SESSION_DEBUG:-0}" = 1 ]; then
	log "SAIRIOS_SESSION_DEBUG=1: enabling the weston debug protocol (screenshots)"
	WESTON_ARGS="$WESTON_ARGS --debug"
fi

# Deliberately unquoted: WESTON_ARGS is a fixed set of flags built above, never
# user input.
# shellcheck disable=SC2086
exec "$WESTON_BIN" $WESTON_ARGS
