#!/usr/bin/env bash
#
# Boot a built SairiOS image in QEMU with a graphical display.
#
# Build the image first:
#   ./vm/qemu/build-image.sh --arch arm64 --yes
#
# ---------------------------------------------------------------------------
# THIS SCRIPT HAS NEVER BEEN EXECUTED.
# ---------------------------------------------------------------------------
# The authoring host was macOS on arm64 with no QEMU installed. No VM has been booted,
# no accelerator has been exercised and no firmware path has been confirmed to exist.
# The command line below is assembled from QEMU's documented behaviour, not from
# observation. See vm/README.md, "Unverified".
#
# Usage:
#   ./vm/qemu/run-vm.sh [--arch amd64|arm64] [--dry-run] [--memory 4096] [--cpus 4]
#                       [--accel auto|kvm|hvf|tcg] [--display auto|cocoa|gtk|sdl|none]
#                       [--forward-shell] [--ephemeral]

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly SCRIPT_DIR REPO_ROOT

if [ ! -f "$REPO_ROOT/package.json" ] ||
	! grep -q '"name": *"sairios"' "$REPO_ROOT/package.json"; then
	printf 'run-vm.sh: refusing to run: %s does not look like the sairios repository\n' \
		"$REPO_ROOT" >&2
	exit 1
fi

readonly OUT_DIR="$REPO_ROOT/vm/out"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ARCH=""
DRY_RUN=0
MEMORY=4096
CPUS=4
ACCEL_CHOICE="auto"
QEMU_OVERRIDE=""
WANT_GL=0
DISPLAY_CHOICE="auto"
FORWARD_SHELL=0
EPHEMERAL=0
FIRMWARE_OVERRIDE=""
SSH_HOST_PORT=22022
SHELL_HOST_PORT=7800

say() { printf '%s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'run-vm.sh: warning: %s\n' "$*" >&2; }

die() {
	printf '\nrun-vm.sh: error: %s\n' "$1" >&2
	shift
	for line in "$@"; do printf '  %s\n' "$line" >&2; done
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }
file_size() { wc -c <"$1" | tr -d ' '; }

# Quote an argument for display only when it actually needs it. printf %q escapes every
# comma, and a QEMU command line is mostly commas, so %q turns a line a reader is meant
# to copy into a thicket of backslashes. Commas, equals, colons and slashes are safe
# unquoted; anything else gets single quotes.
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
Boot a built SairiOS image in QEMU with a graphical display.

  --arch amd64|arm64   Guest architecture. Default: matches the host.
  --dry-run            Print the full qemu command line and exit. Boots nothing.
  --memory MB          Guest RAM in MiB. Default: 4096.
  --cpus N             Guest vCPUs. Default: 4.
  --accel MODE         auto | kvm | hvf | tcg. Default: auto.
  --display MODE       auto | cocoa | gtk | sdl | none. Default: auto.
  --firmware PATH      aarch64 UEFI code blob, if it is somewhere unusual.
  --forward-shell      Also forward guest 7800 to 127.0.0.1:7800. Read the warning.
  --ephemeral          Discard all disk writes on exit (qemu -snapshot).
  --help, -h           This message.

Always forwarded: guest 22 -> 127.0.0.1:22022, loopback only.

Quit: Ctrl-A then X in the terminal, or close the QEMU window.
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
	--qemu) QEMU_OVERRIDE="${2:?--qemu needs a path}" && shift 2 ;;
	--qemu=*) QEMU_OVERRIDE="${1#*=}" && shift ;;
	--gl) WANT_GL=1 && shift ;;
	--display) DISPLAY_CHOICE="${2:?--display needs a value}" && shift 2 ;;
	--display=*) DISPLAY_CHOICE="${1#*=}" && shift ;;
	--firmware) FIRMWARE_OVERRIDE="${2:?--firmware needs a path}" && shift 2 ;;
	--firmware=*) FIRMWARE_OVERRIDE="${1#*=}" && shift ;;
	--forward-shell) FORWARD_SHELL=1 && shift ;;
	--ephemeral) EPHEMERAL=1 && shift ;;
	--dry-run) DRY_RUN=1 && shift ;;
	--help | -h)
		usage
		exit 0
		;;
	*) die "unknown option: $1" "run --help for usage" ;;
	esac
done

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

# Hardware acceleration requires the guest architecture to equal the host
# architecture. There is no way around this and no flag that changes it: KVM and HVF
# both run guest instructions on the physical CPU. A mismatched pair falls back to TCG,
# QEMU's interpreter, which is roughly an order of magnitude slower.
detect_accel() {
	if [ "$HOST_ARCH" != "$ARCH" ]; then
		printf 'tcg'
		return
	fi
	case "$HOST_OS" in
	Linux)
		# Readable AND writable: /dev/kvm often exists but is owned by the kvm group,
		# and a user who is not a member gets a permission error at the worst moment.
		if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then printf 'kvm'; else printf 'tcg'; fi
		;;
	Darwin) printf 'hvf' ;;
	*) printf 'tcg' ;;
	esac
}

if [ "$ACCEL_CHOICE" = auto ]; then
	ACCEL="$(detect_accel)"
else
	ACCEL="$ACCEL_CHOICE"
fi

case "$ACCEL" in
kvm | hvf | tcg) ;;
*) die "unsupported --accel '$ACCEL'" "supported: auto, kvm, hvf, tcg" ;;
esac
readonly ACCEL

# ---------------------------------------------------------------------------
# QEMU binary
# ---------------------------------------------------------------------------

case "$ARCH" in
amd64) QEMU_BIN="qemu-system-x86_64" ;;
arm64) QEMU_BIN="qemu-system-aarch64" ;;
esac
# A QEMU from elsewhere, for the case Homebrew's cannot cover. Its build without
# virglrenderer gives the guest no GL, which is what stops the kiosk session from
# presenting; UTM ships a QEMU that has it. See vm/README.md, "Seeing the desktop".
[ -n "$QEMU_OVERRIDE" ] && QEMU_BIN="$QEMU_OVERRIDE"
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
readonly DISK SEED

for f in "$DISK" "$SEED"; do
	[ -f "$f" ] || die "missing $f" \
		"" \
		"Build the image first:" \
		"  ./vm/qemu/build-image.sh --arch $ARCH --yes"
done

# ---------------------------------------------------------------------------
# UEFI firmware (arm64 only)
# ---------------------------------------------------------------------------
# The aarch64 `virt` machine has no built-in firmware. It needs an edk2 build supplied
# as pflash, plus a writable variable store. amd64 uses QEMU's bundled SeaBIOS and needs
# none of this, which is why the whole block is arch-conditional.

readonly PFLASH_SIZE=67108864 # 64 MiB. The aarch64 virt machine requires exactly this.

FIRMWARE_CODE=""
FIRMWARE_VARS=""

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

# Copy a firmware blob to a 64 MiB pflash image. Distribution builds differ: Debian's
# AAVMF_CODE.fd is already padded to 64 MiB, while QEMU_EFI.fd is a bare 2 MiB build.
# Handing an unpadded file to -drive if=pflash fails with "device requires N bytes,
# image is M bytes", which is a legible error but an avoidable one.
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
			die "$src is $size bytes, larger than the 64 MiB pflash slot" \
				"This is not a firmware build the aarch64 virt machine can use."
		fi
		dd if="$src" of="$dst" conv=notrunc 2>/dev/null
	fi
}

if [ "$ARCH" = arm64 ]; then
	if [ -n "$FIRMWARE_OVERRIDE" ]; then
		[ -f "$FIRMWARE_OVERRIDE" ] ||
			die "--firmware: no such file: $FIRMWARE_OVERRIDE"
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

	# As with the missing-QEMU case above: a dry run is a planning tool, so it reports
	# the gap and keeps printing the plan. A real boot still stops here.
	if [ -z "$FIRMWARE_CODE" ] && [ "$DRY_RUN" -eq 1 ]; then
		warn "no aarch64 UEFI firmware found; this dry run continues, a real boot would stop"
		warn "install it with: brew install qemu | sudo apt-get install -y qemu-efi-aarch64"
	elif [ -z "$FIRMWARE_CODE" ]; then
		die "no aarch64 UEFI firmware found." \
			"" \
			"An aarch64 guest cannot boot without edk2 firmware; the virt machine has" \
			"no built-in BIOS. Searched:" \
			"  /opt/homebrew/share/qemu/edk2-aarch64-code.fd   (Homebrew, Apple Silicon)" \
			"  /usr/local/share/qemu/edk2-aarch64-code.fd      (Homebrew, Intel)" \
			"  /usr/share/AAVMF/AAVMF_CODE.fd                  (Debian/Ubuntu)" \
			"  /usr/share/qemu-efi-aarch64/QEMU_EFI.fd         (Debian/Ubuntu)" \
			"  /usr/share/edk2/aarch64/QEMU_EFI.silent.fd      (Fedora)" \
			"  /usr/share/edk2-armvirt/aarch64/QEMU_EFI.fd     (Arch)" \
			"" \
			"Install it:" \
			"  macOS          brew install qemu   (ships edk2-aarch64-code.fd)" \
			"  Debian/Ubuntu  sudo apt-get install -y qemu-efi-aarch64" \
			"  Fedora         sudo dnf install -y edk2-aarch64" \
			"  Arch           sudo pacman -S edk2-armvirt" \
			"" \
			"If it is installed somewhere else, point at it directly:" \
			"  ./vm/qemu/run-vm.sh --arch arm64 --firmware /path/to/edk2-aarch64-code.fd"
	fi

	FIRMWARE_VARS_TEMPLATE="$(find_first \
		/opt/homebrew/share/qemu/edk2-arm-vars.fd \
		/usr/local/share/qemu/edk2-arm-vars.fd \
		/usr/share/qemu/edk2-arm-vars.fd \
		/usr/share/AAVMF/AAVMF_VARS.fd \
		/usr/share/edk2/aarch64/vars-template-pflash.raw \
		|| true)"

	# Per-VM copies in vm/out/. The code blob must never be written to (it is attached
	# readonly), and the variable store must be per-machine: sharing one across VMs
	# means one machine's boot entries end up in another's NVRAM.
	FIRMWARE_CODE_COPY="$OUT_DIR/firmware-code-${ARCH}.fd"
	FIRMWARE_VARS="$OUT_DIR/firmware-vars-${ARCH}.fd"

	prepare_pflash "$FIRMWARE_CODE" "$FIRMWARE_CODE_COPY"
	if [ ! -f "$FIRMWARE_VARS" ] || [ "$DRY_RUN" -eq 1 ]; then
		# An all-zero variable store is valid: edk2 initialises it on first boot.
		prepare_pflash "${FIRMWARE_VARS_TEMPLATE:-}" "$FIRMWARE_VARS"
	fi
fi

# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

if [ "$DISPLAY_CHOICE" = auto ]; then
	case "$HOST_OS" in
	Darwin) DISPLAY_MODE="cocoa" ;;
	Linux) DISPLAY_MODE="gtk" ;;
	*) DISPLAY_MODE="sdl" ;;
	esac
else
	DISPLAY_MODE="$DISPLAY_CHOICE"
fi
readonly DISPLAY_MODE

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------
# Every forward binds 127.0.0.1 on the host explicitly. Without the address, QEMU binds
# 0.0.0.0 and the VM's SSH port is offered to the entire local network.

NETDEV="user,id=net0,hostfwd=tcp:127.0.0.1:${SSH_HOST_PORT}-:22"

if [ "$FORWARD_SHELL" -eq 1 ]; then
	NETDEV="${NETDEV},hostfwd=tcp:127.0.0.1:${SHELL_HOST_PORT}-:7800"
fi
readonly NETDEV

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

QEMU_ARGS=()

case "$ARCH" in
arm64)
	QEMU_ARGS+=(-machine "virt,accel=${ACCEL}")
	# -cpu host passes the physical CPU through and is only valid under an accelerator.
	# cortex-a72 is the safe TCG choice: `max` enables emulated features that make an
	# already slow interpreter slower.
	if [ "$ACCEL" = tcg ]; then
		QEMU_ARGS+=(-cpu cortex-a72)
	else
		QEMU_ARGS+=(-cpu host)
	fi
	QEMU_ARGS+=(
		-drive "if=pflash,format=raw,unit=0,readonly=on,file=${FIRMWARE_CODE_COPY}"
		-drive "if=pflash,format=raw,unit=1,file=${FIRMWARE_VARS}"
	)
	# The virt machine has no legacy VGA, so a virtio GPU is the only option.
	# Nothing renders until the guest kernel binds the DRM driver, which means an
	# intentionally blank window for the first few seconds.
	#
	# virtio-gpu-gl-pci exposes virgl, which the guest needs for working GL. Without
	# it the compositor falls back to software and cannot scan out: wlroots reports
	# `Basic output test failed`. Most distribution QEMU builds, Homebrew's included,
	# omit virglrenderer and therefore do not have this device at all, so it is only
	# used when both requested and actually present.
	if [ "$WANT_GL" -eq 1 ] && "$QEMU_BIN" -device help 2>/dev/null | grep -q virtio-gpu-gl-pci; then
		QEMU_ARGS+=(-device virtio-gpu-gl-pci)
	else
		if [ "$WANT_GL" -eq 1 ]; then
			warn "$QEMU_BIN has no virtio-gpu-gl-pci; falling back to virtio-gpu-pci"
			warn "the guest will have no GL and the kiosk session will not present"
		fi
		QEMU_ARGS+=(-device virtio-gpu-pci)
	fi
	;;
amd64)
	QEMU_ARGS+=(-machine "q35,accel=${ACCEL}")
	if [ "$ACCEL" = tcg ]; then
		QEMU_ARGS+=(-cpu max)
	else
		QEMU_ARGS+=(-cpu host)
	fi
	# virtio-vga rather than virtio-gpu-pci: it keeps a legacy VGA adapter alongside
	# the virtio device, so firmware and bootloader output is visible before the DRM
	# driver loads. On amd64 that early text is most of the value of a graphical boot.
	QEMU_ARGS+=(-device virtio-vga)
	;;
esac

# shellcheck disable=SC2054  # QEMU option strings use commas internally;
# `-device virtio-net-pci,netdev=net0` is a single argument, not two.
QEMU_ARGS+=(
	-m "$MEMORY"
	-smp "$CPUS"
	# The OS disk. Explicit format=qcow2 because letting QEMU probe the format of a
	# writable image is a known security footgun.
	-drive "if=virtio,format=qcow2,file=${DISK}"
	# The cloud-init seed, attached as a read-only virtio disk rather than a CD.
	# The aarch64 virt machine has no IDE or SATA controller, so a CD-ROM would work on
	# amd64 and fail on arm64. cloud-init finds it by its CIDATA volume label, not by
	# device type, so one code path serves both.
	-drive "if=virtio,format=raw,readonly=on,file=${SEED}"
	-netdev "$NETDEV"
	-device virtio-net-pci,netdev=net0
	# USB input. The aarch64 virt machine has no PS/2 controller, so without these
	# there is no keyboard or pointer at all. usb-tablet reports absolute coordinates,
	# which avoids the pointer drift you get from a relative mouse in a VM.
	-device qemu-xhci,id=xhci
	-device usb-kbd
	-device usb-tablet
	# Without a virtio RNG the guest can block on entropy during early boot, which
	# looks like a hang and is not one.
	-object rng-random,filename=/dev/urandom,id=rng0
	-device virtio-rng-pci,rng=rng0
	-display "$DISPLAY_MODE"
	# Serial to the terminal as well as the graphical window. This is where the kernel
	# log, cloud-init output and the SairiOS first-boot report appear; the graphical
	# window shows only the session. mon: multiplexes the QEMU monitor onto the same
	# stream, so Ctrl-A X quits and Ctrl-A C reaches the monitor.
	-serial mon:stdio
	-name "SairiOS (${ARCH})"
)

if [ "$EPHEMERAL" -eq 1 ]; then
	# All writes go to a temporary overlay and are discarded on exit. The disk file is
	# left byte-identical, which makes repeated first-boot testing cheap.
	QEMU_ARGS+=(-snapshot)
fi

# ---------------------------------------------------------------------------
# Report and run
# ---------------------------------------------------------------------------

say ""
say "SairiOS VM"
say "----------"
say "  guest        : $ARCH"
say "  host         : $HOST_OS $(uname -m)"
say "  accelerator  : $ACCEL"
say "  memory/cpus  : ${MEMORY} MiB / ${CPUS} vCPU"
say "  display      : $DISPLAY_MODE"
say "  disk         : $DISK"
say "  seed         : $SEED"
[ "$ARCH" = arm64 ] &&
	say "  firmware     : ${FIRMWARE_CODE:-NOT FOUND (a real boot would stop here)}"
[ "$EPHEMERAL" -eq 1 ] && say "  ephemeral    : yes, all disk writes are discarded on exit"
say "  ssh          : ssh -p ${SSH_HOST_PORT} debian@127.0.0.1   (needs --ssh-key at build time)"
say ""

if [ "$ACCEL" = tcg ]; then
	say "  ---------------------------------------------------------------------"
	if [ "$HOST_ARCH" != "$ARCH" ]; then
		say "  SLOW: $ARCH guest on an $HOST_ARCH host. Hardware acceleration requires"
		say "  the architectures to match, so this runs under TCG, QEMU's software"
		say "  interpreter. Expect boot to take minutes rather than seconds."
		say ""
		say "  On this host, prefer:  --arch $HOST_ARCH"
	elif [ "$HOST_OS" = Linux ]; then
		say "  SLOW: no usable /dev/kvm, so this runs under TCG software emulation."
		say "  Check that KVM is available and that you can open the device:"
		say "      ls -l /dev/kvm"
		say "      sudo usermod -aG kvm \"\$USER\"    # then log out and back in"
	else
		say "  SLOW: running under TCG software emulation, roughly an order of"
		say "  magnitude slower than hardware acceleration."
	fi
	say "  ---------------------------------------------------------------------"
	say ""
fi

if [ "$FORWARD_SHELL" -eq 1 ]; then
	say "  ---------------------------------------------------------------------"
	say "  --forward-shell will NOT work on its own, and this is worth reading."
	say ""
	say "  QEMU's user-mode networking forwards to the guest's DHCP address"
	say "  (10.0.2.15), but the SairiOS shell binds 127.0.0.1 inside the guest, so"
	say "  the forwarded connection arrives at an address nothing is listening on."
	say ""
	say "  The right way to reach the shell from the host is an SSH tunnel, which"
	say "  terminates inside the guest and therefore does reach loopback:"
	say ""
	say "      ssh -N -L 7800:127.0.0.1:7800 -p ${SSH_HOST_PORT} debian@127.0.0.1"
	say "      open http://127.0.0.1:7800"
	say ""
	say "  Making the hostfwd work instead would mean setting SAIRIOS_BIND_HOST to"
	say "  0.0.0.0 in the guest, which exposes the services to the guest's whole"
	say "  network. Do not do that to see a page load."
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

say "  Quit with Ctrl-A then X, or by closing the QEMU window."
say "  The first boot runs cloud-init and takes noticeably longer than later boots."
say ""

exec "$QEMU_BIN" "${QEMU_ARGS[@]}"
