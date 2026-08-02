#!/usr/bin/env bash
#
# Boot a built SairiOS image in QEMU with no display, driving it over the serial console.
#
# Two modes:
#
#   default   Interactive. `-nographic`, serial on your terminal. Quit with Ctrl-A X.
#   --smoke   Automated. Boots the VM, watches the serial log for the SairiOS first-boot
#             report, and exits non-zero if it never arrives or reports failure. This is
#             the CI signal.
#
# ---------------------------------------------------------------------------
# THIS SCRIPT HAS NEVER BEEN EXECUTED.
# ---------------------------------------------------------------------------
# The authoring host was macOS on arm64 with no QEMU installed. No VM has been booted and
# no smoke test has ever passed or failed. See vm/README.md, "Unverified".
#
# Exit status in --smoke mode:
#   0  the guest reported OK, or DEGRADED without --strict
#   1  the guest reported FAIL, or DEGRADED with --strict
#   2  the timeout expired with no verdict on the serial console
#   3  QEMU exited before the guest produced a verdict

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly SCRIPT_DIR REPO_ROOT

if [ ! -f "$REPO_ROOT/package.json" ] ||
	! grep -q '"name": *"sairios"' "$REPO_ROOT/package.json"; then
	printf 'run-vm-headless.sh: refusing to run: %s does not look like the sairios repository\n' \
		"$REPO_ROOT" >&2
	exit 1
fi

readonly OUT_DIR="$REPO_ROOT/vm/out"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ARCH=""
DRY_RUN=0
SMOKE=0
STRICT=0
PERSIST=0
MEMORY=2048
CPUS=2
ACCEL_CHOICE="auto"
FIRMWARE_OVERRIDE=""
# Ten minutes. Enough for an accelerated first boot with apt and NodeSource on a normal
# connection; not enough for a cross-architecture TCG boot, which needs --timeout 2400.
TIMEOUT=600
SSH_HOST_PORT=22022

say() { printf '%s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'run-vm-headless.sh: warning: %s\n' "$*" >&2; }

die() {
	printf '\nrun-vm-headless.sh: error: %s\n' "$1" >&2
	shift
	for line in "$@"; do printf '  %s\n' "$line" >&2; done
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }
file_size() { wc -c <"$1" | tr -d ' '; }

# Display-only quoting. printf %q escapes every comma, and a QEMU command line is mostly
# commas; that turns a line meant to be copied into a thicket of backslashes.
quote_arg() {
	case "$1" in
	'') printf "''" ;;
	*[!A-Za-z0-9_@%+=:,./-]*)
		printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
		;;
	*) printf '%s' "$1" ;;
	esac
}

usage() {
	cat <<'EOF'
Boot a built SairiOS image headless, over the serial console.

  --arch amd64|arm64   Guest architecture. Default: matches the host.
  --smoke              Automated boot check. Exits non-zero on failure.
  --strict             In --smoke, treat DEGRADED as failure. Requires a delivered
                       product tree in the image; a bare image cannot pass this.
  --timeout SECONDS    Bound on the smoke check. Default: 600.
  --persist            In --smoke, keep disk writes. Default is to discard them so the
                       check re-tests first boot every run.
  --memory MB          Guest RAM in MiB. Default: 2048.
  --cpus N             Guest vCPUs. Default: 2.
  --accel MODE         auto | kvm | hvf | tcg. Default: auto.
  --firmware PATH      aarch64 UEFI code blob, if it is somewhere unusual.
  --dry-run            Print the full qemu command line and exit. Boots nothing.
  --help, -h           This message.

Serial log: vm/out/serial-<arch>.log

Interactive mode quits with Ctrl-A then X.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--arch) ARCH="${2:?--arch needs a value}" && shift 2 ;;
	--arch=*) ARCH="${1#*=}" && shift ;;
	--memory) MEMORY="${2:?--memory needs a value}" && shift 2 ;;
	--memory=*) MEMORY="${1#*=}" && shift ;;
	--cpus) CPUS="${2:?--cpus needs a value}" && shift 2 ;;
	--cpus=*) CPUS="${1#*=}" && shift ;;
	--accel) ACCEL_CHOICE="${2:?--accel needs a value}" && shift 2 ;;
	--accel=*) ACCEL_CHOICE="${1#*=}" && shift ;;
	--timeout) TIMEOUT="${2:?--timeout needs a value}" && shift 2 ;;
	--timeout=*) TIMEOUT="${1#*=}" && shift ;;
	--firmware) FIRMWARE_OVERRIDE="${2:?--firmware needs a path}" && shift 2 ;;
	--firmware=*) FIRMWARE_OVERRIDE="${1#*=}" && shift ;;
	--smoke) SMOKE=1 && shift ;;
	--strict) STRICT=1 && shift ;;
	--persist) PERSIST=1 && shift ;;
	--dry-run) DRY_RUN=1 && shift ;;
	--help | -h)
		usage
		exit 0
		;;
	*) die "unknown option: $1" "run --help for usage" ;;
	esac
done

case "$TIMEOUT" in
'' | *[!0-9]*) die "--timeout must be a whole number of seconds, got '$TIMEOUT'" ;;
esac

# ---------------------------------------------------------------------------
# Architecture, host, accelerator
# ---------------------------------------------------------------------------

host_arch() {
	case "$(uname -m)" in
	x86_64 | amd64) printf 'amd64' ;;
	arm64 | aarch64) printf 'arm64' ;;
	*) printf 'other' ;;
	esac
}

HOST_ARCH="$(host_arch)"
HOST_OS="$(uname -s)"
readonly HOST_ARCH HOST_OS

if [ -z "$ARCH" ]; then
	[ "$HOST_ARCH" != other ] ||
		die "cannot infer guest architecture from host '$(uname -m)'" \
			"pass --arch amd64 or --arch arm64"
	ARCH="$HOST_ARCH"
fi

case "$ARCH" in
amd64 | arm64) ;;
*) die "unsupported --arch '$ARCH'" "supported: amd64, arm64" ;;
esac
readonly ARCH

detect_accel() {
	if [ "$HOST_ARCH" != "$ARCH" ]; then
		printf 'tcg'
		return
	fi
	case "$HOST_OS" in
	Linux) if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then printf 'kvm'; else printf 'tcg'; fi ;;
	Darwin) printf 'hvf' ;;
	*) printf 'tcg' ;;
	esac
}

if [ "$ACCEL_CHOICE" = auto ]; then ACCEL="$(detect_accel)"; else ACCEL="$ACCEL_CHOICE"; fi
case "$ACCEL" in
kvm | hvf | tcg) ;;
*) die "unsupported --accel '$ACCEL'" "supported: auto, kvm, hvf, tcg" ;;
esac
readonly ACCEL

case "$ARCH" in
amd64) QEMU_BIN="qemu-system-x86_64" ;;
arm64) QEMU_BIN="qemu-system-aarch64" ;;
esac
readonly QEMU_BIN

if ! have "$QEMU_BIN"; then
	case "$ARCH" in
	amd64) deb_pkg="qemu-system-x86" && dnf_pkg="qemu-system-x86" ;;
	arm64) deb_pkg="qemu-system-arm qemu-efi-aarch64" && dnf_pkg="qemu-system-aarch64 edk2-aarch64" ;;
	esac
	# A dry run is a planning tool: report the gap and keep printing the plan so
	# the full qemu command line can be read on a machine without QEMU. A real
	# boot still stops here.
	if [ "$DRY_RUN" -eq 1 ]; then
		warn "$QEMU_BIN is not installed; this dry run continues, a real boot would stop"
		warn "install it with: brew install qemu | sudo apt-get install -y $deb_pkg"
	else
		die "$QEMU_BIN is not installed." \
			"" \
			"  macOS          brew install qemu" \
			"  Debian/Ubuntu  sudo apt-get install -y $deb_pkg" \
			"  Fedora         sudo dnf install -y $dnf_pkg" \
			"  Arch           sudo pacman -S qemu-full"
	fi
fi

# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

DISK="$OUT_DIR/sairios-${ARCH}.qcow2"
SEED="$OUT_DIR/seed-${ARCH}.iso"
SERIAL_LOG="$OUT_DIR/serial-${ARCH}.log"
QEMU_LOG="$OUT_DIR/qemu-${ARCH}.log"
readonly DISK SEED SERIAL_LOG QEMU_LOG

for f in "$DISK" "$SEED"; do
	[ -f "$f" ] || die "missing $f" \
		"" \
		"Build the image first:" \
		"  ./vm/qemu/build-image.sh --arch $ARCH --yes"
done

# ---------------------------------------------------------------------------
# UEFI firmware (arm64 only)
# ---------------------------------------------------------------------------

readonly PFLASH_SIZE=67108864 # 64 MiB, required by the aarch64 virt machine.
FIRMWARE_CODE=""

find_first() {
	local candidate
	for candidate in "$@"; do
		if [ -f "$candidate" ]; then
			printf '%s' "$candidate"
			return 0
		fi
	done
	return 1
}

prepare_pflash() {
	local src="$1" dst="$2" size

	if [ "$DRY_RUN" -eq 1 ]; then
		info "would prepare pflash image $dst from ${src:-<zero-filled>}"
		return 0
	fi

	dd if=/dev/zero of="$dst" bs=1048576 count=64 2>/dev/null
	if [ -n "$src" ]; then
		size="$(file_size "$src")"
		if [ "$size" -gt "$PFLASH_SIZE" ]; then
			die "$src is $size bytes, larger than the 64 MiB pflash slot"
		fi
		dd if="$src" of="$dst" conv=notrunc 2>/dev/null
	fi
}

if [ "$ARCH" = arm64 ]; then
	if [ -n "$FIRMWARE_OVERRIDE" ]; then
		[ -f "$FIRMWARE_OVERRIDE" ] || die "--firmware: no such file: $FIRMWARE_OVERRIDE"
		FIRMWARE_CODE="$FIRMWARE_OVERRIDE"
	else
		FIRMWARE_CODE="$(find_first \
			/opt/homebrew/share/qemu/edk2-aarch64-code.fd \
			/usr/local/share/qemu/edk2-aarch64-code.fd \
			/usr/share/qemu/edk2-aarch64-code.fd \
			/usr/share/AAVMF/AAVMF_CODE.fd \
			/usr/share/AAVMF/AAVMF_CODE.no-secboot.fd \
			/usr/share/qemu-efi-aarch64/QEMU_EFI.fd \
			/usr/share/edk2/aarch64/QEMU_EFI.silent.fd \
			/usr/share/edk2/aarch64/QEMU_EFI.fd \
			/usr/share/edk2-armvirt/aarch64/QEMU_EFI.fd \
			|| true)"
	fi

	# As with the missing-QEMU case above: a dry run reports the gap and keeps printing
	# the plan. A real boot still stops here.
	if [ -z "$FIRMWARE_CODE" ] && [ "$DRY_RUN" -eq 1 ]; then
		warn "no aarch64 UEFI firmware found; this dry run continues, a real boot would stop"
		warn "install it with: brew install qemu | sudo apt-get install -y qemu-efi-aarch64"
	elif [ -z "$FIRMWARE_CODE" ]; then
		die "no aarch64 UEFI firmware found." \
			"" \
			"  macOS          brew install qemu" \
			"  Debian/Ubuntu  sudo apt-get install -y qemu-efi-aarch64" \
			"  Fedora         sudo dnf install -y edk2-aarch64" \
			"  Arch           sudo pacman -S edk2-armvirt" \
			"" \
			"Or point at it directly with --firmware PATH." \
			"run-vm.sh lists every path that was searched."
	fi

	FIRMWARE_VARS_TEMPLATE="$(find_first \
		/opt/homebrew/share/qemu/edk2-arm-vars.fd \
		/usr/local/share/qemu/edk2-arm-vars.fd \
		/usr/share/qemu/edk2-arm-vars.fd \
		/usr/share/AAVMF/AAVMF_VARS.fd \
		/usr/share/edk2/aarch64/vars-template-pflash.raw \
		|| true)"

	FIRMWARE_CODE_COPY="$OUT_DIR/firmware-code-${ARCH}.fd"
	FIRMWARE_VARS="$OUT_DIR/firmware-vars-headless-${ARCH}.fd"

	prepare_pflash "$FIRMWARE_CODE" "$FIRMWARE_CODE_COPY"
	# A separate variable store from the graphical runner, so a headless CI run and an
	# interactive session never fight over the same NVRAM file.
	prepare_pflash "${FIRMWARE_VARS_TEMPLATE:-}" "$FIRMWARE_VARS"
fi

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

QEMU_ARGS=()

case "$ARCH" in
arm64)
	QEMU_ARGS+=(-machine "virt,accel=${ACCEL}")
	if [ "$ACCEL" = tcg ]; then QEMU_ARGS+=(-cpu cortex-a72); else QEMU_ARGS+=(-cpu host); fi
	QEMU_ARGS+=(
		-drive "if=pflash,format=raw,unit=0,readonly=on,file=${FIRMWARE_CODE_COPY}"
		-drive "if=pflash,format=raw,unit=1,file=${FIRMWARE_VARS}"
	)
	;;
amd64)
	QEMU_ARGS+=(-machine "q35,accel=${ACCEL}")
	if [ "$ACCEL" = tcg ]; then QEMU_ARGS+=(-cpu max); else QEMU_ARGS+=(-cpu host); fi
	;;
esac

# shellcheck disable=SC2054  # QEMU option strings use commas internally;
# `-device virtio-net-pci,netdev=net0` is a single argument, not two.
QEMU_ARGS+=(
	-m "$MEMORY"
	-smp "$CPUS"
	-drive "if=virtio,format=qcow2,file=${DISK}"
	-drive "if=virtio,format=raw,readonly=on,file=${SEED}"
	-netdev "user,id=net0,hostfwd=tcp:127.0.0.1:${SSH_HOST_PORT}-:22"
	-device virtio-net-pci,netdev=net0
	# Kept even though nothing is displayed. cage needs a DRM device to start, so
	# dropping the GPU here would make the headless run exercise a different system
	# than the graphical one, and the session failure would only ever appear in CI.
	# -display none means the framebuffer is rendered and thrown away, which is cheap.
	-device virtio-gpu-pci
	-object rng-random,filename=/dev/urandom,id=rng0
	-device virtio-rng-pci,rng=rng0
	# A guest reboot would restart the boot being measured and could loop forever
	# inside the timeout. Exiting instead turns a reboot loop into a clean failure.
	-no-reboot
)

if [ "$SMOKE" -eq 1 ]; then
	QEMU_ARGS+=(
		-display none
		# Serial to a file, not to stdio: the check greps this while the VM runs.
		-serial "file:${SERIAL_LOG}"
		# No monitor. Nothing is going to type at it, and an unattached monitor on
		# stdio interferes with running QEMU as a background job.
		-monitor none
	)
	if [ "$PERSIST" -eq 0 ]; then
		# Writes go to a temporary overlay and are discarded. This is what makes the
		# smoke test repeatable: every run tests first boot, not the accumulated state
		# of previous runs.
		QEMU_ARGS+=(-snapshot)
	fi
else
	# -nographic implies -display none and puts the serial console and the QEMU monitor
	# on stdio, multiplexed. Ctrl-A X quits, Ctrl-A C switches to the monitor.
	QEMU_ARGS+=(-nographic)
fi

QEMU_ARGS+=(-name "SairiOS headless (${ARCH})")

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

say ""
say "SairiOS VM (headless)"
say "---------------------"
say "  guest        : $ARCH"
say "  host         : $HOST_OS $(uname -m)"
say "  accelerator  : $ACCEL"
say "  memory/cpus  : ${MEMORY} MiB / ${CPUS} vCPU"
say "  disk         : $DISK"
if [ "$SMOKE" -eq 1 ]; then
	say "  mode         : smoke check, timeout ${TIMEOUT}s"
	say "  serial log   : $SERIAL_LOG"
	[ "$PERSIST" -eq 0 ] && say "  disk writes  : discarded on exit (-snapshot)"
	[ "$STRICT" -eq 1 ] && say "  strict       : DEGRADED will be treated as failure"
else
	say "  mode         : interactive, serial on this terminal"
fi
say ""

if [ "$ACCEL" = tcg ]; then
	say "  ---------------------------------------------------------------------"
	say "  SLOW: running under TCG software emulation."
	if [ "$HOST_ARCH" != "$ARCH" ]; then
		say "  A $ARCH guest cannot be accelerated on an $HOST_ARCH host."
	fi
	if [ "$SMOKE" -eq 1 ] && [ "$TIMEOUT" -lt 1800 ]; then
		say ""
		say "  A first boot under TCG installs packages through an interpreter and"
		say "  routinely exceeds ${TIMEOUT}s. Consider:  --timeout 2400"
	fi
	say "  ---------------------------------------------------------------------"
	say ""
fi

if [ "$DRY_RUN" -eq 1 ]; then
	say "DRY RUN. The command line below is not executed."
	say ""
	printf '%s' "$QEMU_BIN"
	for arg in "${QEMU_ARGS[@]}"; do
		case "$arg" in
		-*) printf ' \\\n  %s' "$arg" ;;
		*) printf ' %s' "$(quote_arg "$arg")" ;;
		esac
	done
	printf '\n\n'
	exit 0
fi

# ---------------------------------------------------------------------------
# Interactive
# ---------------------------------------------------------------------------

if [ "$SMOKE" -eq 0 ]; then
	say "  Quit with Ctrl-A then X."
	say ""
	exec "$QEMU_BIN" "${QEMU_ARGS[@]}"
fi

# ---------------------------------------------------------------------------
# Smoke check
# ---------------------------------------------------------------------------

QEMU_PID=""

# Must always succeed: an EXIT trap whose last command fails overwrites the script's
# exit status, which would destroy the verdict this whole script exists to report.
cleanup() {
	if [ -n "${QEMU_PID:-}" ] && kill -0 "$QEMU_PID" 2>/dev/null; then
		kill -TERM "$QEMU_PID" 2>/dev/null || true
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			kill -0 "$QEMU_PID" 2>/dev/null || break
			sleep 1
		done
		if kill -0 "$QEMU_PID" 2>/dev/null; then
			kill -KILL "$QEMU_PID" 2>/dev/null || true
		fi
	fi
	return 0
}
trap cleanup EXIT INT TERM

# Start from an empty log so a verdict from a previous run can never be read as this
# run's result. That mistake makes a broken image look green, which is the worst
# possible failure mode for a smoke test.
: >"$SERIAL_LOG"
: >"$QEMU_LOG"

say "  Booting. First boot runs cloud-init and is much slower than later boots."
say "  Watch with:  tail -f $SERIAL_LOG"
say ""

"$QEMU_BIN" "${QEMU_ARGS[@]}" >"$QEMU_LOG" 2>&1 &
QEMU_PID=$!

VERDICT=""
QEMU_DIED=0
START="$(date +%s)"
DEADLINE=$((START + TIMEOUT))
LAST_PROGRESS="$START"

while :; do
	if grep -q 'SAIRIOS-FIRSTBOOT:' "$SERIAL_LOG" 2>/dev/null; then
		# Take the LAST verdict: the unit runs on every boot, and a persisted disk may
		# carry an older report in the same log.
		VERDICT="$(grep -o 'SAIRIOS-FIRSTBOOT: [A-Z]*' "$SERIAL_LOG" |
			tail -n 1 | awk '{print $2}')"
		break
	fi

	if ! kill -0 "$QEMU_PID" 2>/dev/null; then
		QEMU_DIED=1
		break
	fi

	NOW="$(date +%s)"
	if [ "$NOW" -ge "$DEADLINE" ]; then
		break
	fi

	# A progress line every 30s. A silent terminal for ten minutes is
	# indistinguishable from a hung script.
	if [ $((NOW - LAST_PROGRESS)) -ge 30 ]; then
		printf '    ... %ss elapsed, %s lines of serial output\n' \
			"$((NOW - START))" "$(wc -l <"$SERIAL_LOG" | tr -d ' ')"
		LAST_PROGRESS="$NOW"
	fi

	sleep 5
done

ELAPSED=$(($(date +%s) - START))

report_tail() {
	say ""
	say "  --- last 60 lines of $SERIAL_LOG ---"
	tail -n 60 "$SERIAL_LOG" 2>/dev/null || say "  (serial log is empty)"
	say "  --- end ---"
}

say ""

if [ "$QEMU_DIED" -eq 1 ]; then
	say "SMOKE: FAILED after ${ELAPSED}s - QEMU exited before the guest reported."
	say ""
	say "  QEMU's own output is in $QEMU_LOG:"
	tail -n 20 "$QEMU_LOG" 2>/dev/null || true
	report_tail
	say ""
	say "  This is usually a host problem rather than a guest problem: a bad machine"
	say "  type, a missing accelerator, or firmware QEMU could not load. See docs/VM.md."
	exit 3
fi

if [ -z "$VERDICT" ]; then
	say "SMOKE: TIMED OUT after ${ELAPSED}s with no verdict on the serial console."
	report_tail
	say ""
	say "  If the log ends mid-boot, the guest is alive and just slow: re-run with a"
	say "  larger --timeout. If the log is empty, the guest never reached a serial"
	say "  console at all. See docs/VM.md."
	exit 2
fi

# Print the report itself, not just the verdict. In CI the log is the artifact somebody
# reads six hours later, and a bare verdict tells them nothing actionable.
if grep -q 'SAIRIOS FIRST BOOT REPORT' "$SERIAL_LOG" 2>/dev/null; then
	say "  --- guest first-boot report ---"
	sed -n '/==== SAIRIOS FIRST BOOT REPORT/,/END SAIRIOS FIRST BOOT REPORT/p' \
		"$SERIAL_LOG" | tail -n 120
	say "  --- end ---"
	say ""
fi

case "$VERDICT" in
OK)
	say "SMOKE: PASSED after ${ELAPSED}s (verdict OK)."
	exit 0
	;;
DEGRADED)
	if [ "$STRICT" -eq 1 ]; then
		say "SMOKE: FAILED after ${ELAPSED}s (verdict DEGRADED, --strict)."
		say ""
		say "  The operating-system layer provisioned correctly but SairiOS is not"
		say "  running. --strict requires a delivered product tree in /opt/sairios;"
		say "  a bare image cannot pass it. See vm/cloud-init/README.md."
		exit 1
	fi
	say "SMOKE: PASSED after ${ELAPSED}s (verdict DEGRADED)."
	say ""
	say "  The OS layer provisioned correctly. SairiOS itself is not running, which is"
	say "  expected for a freshly built image: /opt/sairios is empty by design."
	say "  Deliver the product tree and re-run with --strict to assert the whole stack."
	exit 0
	;;
FAIL)
	say "SMOKE: FAILED after ${ELAPSED}s (verdict FAIL)."
	say ""
	say "  The guest booted and ran its self-check, and the self-check found the"
	say "  operating-system layer broken. The report above lists every [fail ] line."
	say "  Triage: docs/VM.md."
	exit 1
	;;
*)
	say "SMOKE: FAILED after ${ELAPSED}s - unrecognised verdict '$VERDICT'."
	say "  Expected OK, DEGRADED or FAIL. The guest and this script disagree about"
	say "  the report format; check /usr/local/sbin/sairios-firstboot-check."
	exit 1
	;;
esac
