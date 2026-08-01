#!/usr/bin/env bash
#
# Build a bootable SairiOS VM image from the Debian 12 (bookworm) generic base.
#
# What it does:
#   1. Downloads the published SHA512SUMS for the release and the base qcow2.
#   2. Verifies the image against that checksum and REFUSES to continue on a mismatch.
#   3. Caches the verified base under vm/.cache/ so it is downloaded once.
#   4. Copies it into vm/out/ and grows the working copy.
#   5. Builds a NoCloud seed ISO from vm/cloud-init/.
#
# It does not boot anything, and it does not put SairiOS into the image. The result is a
# provisioned operating-system layer with an empty /opt/sairios. See
# vm/cloud-init/README.md, "Delivering SairiOS to a provisioned machine".
#
# ---------------------------------------------------------------------------
# Verification status
# ---------------------------------------------------------------------------
# This script HAS been executed, on macOS arm64 with QEMU 11.0.3, and the image it
# produces HAS booted: Debian 12 came up, cloud-init provisioned, and the guest ran
# its own first-boot self-check and reported a verdict over the serial console.
#
# Not yet observed: a graphical session. See vm/README.md for exactly which checks
# have passed on a real boot and which have not.
#
# Usage:
#   ./vm/qemu/build-image.sh [--arch amd64|arm64] [--dry-run] [--yes]
#                            [--disk-size 20G] [--ssh-key PATH]
#                            [--expect-sha512 HEX] [--force]
#
# Run with --dry-run first. It prints every command, every URL and every byte it would
# download, and touches nothing.

set -euo pipefail

# ---------------------------------------------------------------------------
# Repository location, and a refusal to operate outside it
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly SCRIPT_DIR REPO_ROOT

if [ ! -f "$REPO_ROOT/package.json" ] ||
	! grep -q '"name": *"sairios"' "$REPO_ROOT/package.json"; then
	printf 'build-image.sh: refusing to run: %s does not look like the sairios repository\n' \
		"$REPO_ROOT" >&2
	exit 1
fi

readonly CACHE_DIR="$REPO_ROOT/vm/.cache"
readonly OUT_DIR="$REPO_ROOT/vm/out"
readonly CLOUD_INIT_DIR="$REPO_ROOT/vm/cloud-init"

# ---------------------------------------------------------------------------
# Upstream constants
# ---------------------------------------------------------------------------
# `latest/` is a symlink that Debian moves on each point release, so the checksum is
# fetched at build time rather than pinned here. Pin a specific build with
# --expect-sha512 if you need byte-for-byte reproducibility.
#
# On 2026-07-31 `latest/` resolved to the 20260722-2547 build, with:
#   debian-12-generic-amd64.qcow2  (size reported by a HEAD at build time)
#     ddc98e22b1c0e6647369fba51e285af155f3f19438f372577fb148817e586eed1
#     0526240aa71abc44a836679bf6f8c70ba3d092d945989905abc0c81907b97b0
#   debian-12-generic-arm64.qcow2  (size reported by a HEAD at build time)
#     ad72c971c4f15ff75408ad22fd5dd6275176a8382d5151859525cb9fd60914bb
#     dd2983e9de3a212889c95def3d53b30992048005fa9659897f06931318d8c663
# Those values will be stale as soon as Debian rebuilds. They are recorded so a reader
# can sanity-check that the script is looking at the right artifact, not to be trusted.
readonly BASE_URL="https://cloud.debian.org/images/cloud/bookworm/latest"
readonly SUMS_NAME="SHA512SUMS"

# Fallback sizes for --dry-run when the network is unavailable. Bytes, measured
# 2026-07-31.
readonly APPROX_SIZE_amd64=348913664
readonly APPROX_SIZE_arm64=339607552

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DRY_RUN=0
ASSUME_YES=0
FORCE=0
DISK_SIZE="20G"
SSH_KEY_PATH=""
SSH_KEY_CONTENT=""
EXPECT_SHA512=""
ARCH=""

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'build-image.sh: warning: %s\n' "$*" >&2; }

die() {
	printf '\nbuild-image.sh: error: %s\n' "$1" >&2
	shift
	for line in "$@"; do
		printf '  %s\n' "$line" >&2
	done
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# Execute, or print what would be executed. Every filesystem-mutating and
# network-touching action goes through this, which is what makes --dry-run honest.
run() {
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    would run:'
		printf ' %q' "$@"
		printf '\n'
		return 0
	fi
	"$@"
}

human_bytes() {
	awk -v b="${1:-0}" 'BEGIN {
		if (b >= 1073741824)   printf "%.2f GiB", b / 1073741824;
		else if (b >= 1048576) printf "%.1f MiB", b / 1048576;
		else if (b >= 1024)    printf "%.1f KiB", b / 1024;
		else                   printf "%d B", b;
	}'
}

usage() {
	cat <<'EOF'
Build a SairiOS VM image from the Debian 12 generic base.

  --arch amd64|arm64     Guest architecture. Default: matches the host.
  --dry-run              Print every step, download nothing, write nothing.
  --yes, -y              Skip the download confirmation prompt. Required in CI.
  --disk-size SIZE       Virtual disk size for the working copy. Default: 20G.
  --ssh-key PATH         Public key to install for triage access. Optional.
  --expect-sha512 HEX    Pin the base image to this checksum; refuse anything else.
  --force                Overwrite an existing working image in vm/out/.
  --help, -h             This message.

Artifacts:
  vm/.cache/   verified base images, expensive to re-download, never auto-deleted
  vm/out/      the working disk and seed ISO, disposable

Examples:
  ./vm/qemu/build-image.sh --dry-run
  ./vm/qemu/build-image.sh --arch arm64 --yes --ssh-key ~/.ssh/id_ed25519.pub
EOF
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
	case "$1" in
	--arch)
		[ $# -ge 2 ] || die "--arch needs a value (amd64 or arm64)"
		ARCH="$2"
		shift 2
		;;
	--arch=*)
		ARCH="${1#*=}"
		shift
		;;
	--disk-size)
		[ $# -ge 2 ] || die "--disk-size needs a value, for example 20G"
		DISK_SIZE="$2"
		shift 2
		;;
	--disk-size=*)
		DISK_SIZE="${1#*=}"
		shift
		;;
	--ssh-key)
		[ $# -ge 2 ] || die "--ssh-key needs a path"
		SSH_KEY_PATH="$2"
		shift 2
		;;
	--ssh-key=*)
		SSH_KEY_PATH="${1#*=}"
		shift
		;;
	--expect-sha512)
		[ $# -ge 2 ] || die "--expect-sha512 needs a hex digest"
		EXPECT_SHA512="$2"
		shift 2
		;;
	--expect-sha512=*)
		EXPECT_SHA512="${1#*=}"
		shift
		;;
	--dry-run)
		DRY_RUN=1
		shift
		;;
	--yes | -y)
		ASSUME_YES=1
		shift
		;;
	--force)
		FORCE=1
		shift
		;;
	--help | -h)
		usage
		exit 0
		;;
	*)
		die "unknown option: $1" "run --help for usage"
		;;
	esac
done

# ---------------------------------------------------------------------------
# Architecture
# ---------------------------------------------------------------------------

if [ -z "$ARCH" ]; then
	case "$(uname -m)" in
	x86_64 | amd64) ARCH=amd64 ;;
	arm64 | aarch64) ARCH=arm64 ;;
	*) die "cannot infer guest architecture from host '$(uname -m)'" \
		"pass --arch amd64 or --arch arm64 explicitly" ;;
	esac
fi

case "$ARCH" in
amd64 | arm64) ;;
*) die "unsupported --arch '$ARCH'" "supported: amd64, arm64" ;;
esac

readonly ARCH
# `generic`, NOT `genericcloud`.
#
# genericcloud ships the `-cloud-` kernel, which is built for headless instances
# and omits the DRM subsystem entirely: `virtio_gpu` is not merely unloaded, it is
# absent from /lib/modules. `cage` needs a DRM master to start, so on that variant
# the graphical session can never come up no matter what QEMU passes. Verified on a
# real boot, which reported:
#
#   modprobe: FATAL: Module virtio_gpu not found in directory /lib/modules/6.1.0-51-cloud-arm64
#
# `generic` carries the full kernel with the virtio DRM driver. It is a few tens of
# megabytes larger, which is the correct trade for a machine that has a screen.
readonly IMAGE_NAME="debian-12-generic-${ARCH}.qcow2"
readonly IMAGE_URL="$BASE_URL/$IMAGE_NAME"
readonly SUMS_URL="$BASE_URL/$SUMS_NAME"
readonly CACHED_IMAGE="$CACHE_DIR/$IMAGE_NAME"
readonly CACHED_SUMS="$CACHE_DIR/${SUMS_NAME}.${ARCH}"
readonly WORK_DISK="$OUT_DIR/sairios-${ARCH}.qcow2"
readonly SEED_ISO="$OUT_DIR/seed-${ARCH}.iso"

# ---------------------------------------------------------------------------
# Required tools
# ---------------------------------------------------------------------------

require_tools() {
	local missing=0

	if ! have curl; then
		warn "curl is not installed"
		missing=1
	fi

	if ! have qemu-img; then
		printf '\nbuild-image.sh: error: qemu-img is not installed.\n' >&2
		printf '  It is needed to grow the base image; the 2 GiB base has no room for\n' >&2
		printf '  Node, cage and cog. Install QEMU:\n\n' >&2
		printf '    macOS         brew install qemu\n' >&2
		printf '    Debian/Ubuntu sudo apt-get install -y qemu-utils\n' >&2
		printf '    Fedora        sudo dnf install -y qemu-img\n\n' >&2
		missing=1
	fi

	if ! sha512_tool >/dev/null; then
		warn "no SHA-512 tool found (need sha512sum, shasum or openssl)"
		missing=1
	fi

	if [ "$missing" -ne 0 ]; then
		# A dry run is a planning tool, not a build. Report what is missing and
		# keep going, so someone can read the whole plan on a machine that is not
		# yet set up. A real build still stops here.
		if [ "$DRY_RUN" -eq 1 ]; then
			warn "the tools above are missing; this dry run continues, a real build would stop"
			return 0
		fi
		die "required tools are missing; see above"
	fi
}

# Print the name of a usable SHA-512 implementation, or fail.
sha512_tool() {
	if have sha512sum; then
		printf 'sha512sum'
	elif have shasum; then
		printf 'shasum'
	elif have openssl; then
		printf 'openssl'
	else
		return 1
	fi
}

# Hex digest of a file, using whichever tool exists. Portable across GNU coreutils,
# macOS/Perl shasum and OpenSSL, all of which format their output differently.
sha512_of() {
	case "$(sha512_tool)" in
	sha512sum) sha512sum "$1" | awk '{print $1}' ;;
	shasum) shasum -a 512 "$1" | awk '{print $1}' ;;
	openssl) openssl dgst -sha512 "$1" | awk '{print $NF}' ;;
	esac
}

# ---------------------------------------------------------------------------
# Seed ISO
# ---------------------------------------------------------------------------

# cloud-init's NoCloud datasource finds the seed by filesystem volume label, so the
# label must be CIDATA and the files must be named user-data / meta-data /
# network-config with no extension.
build_seed_iso() {
	local seed_dir="$1" out="$2" base

	if have xorriso; then
		info "using xorriso"
		run xorriso -as mkisofs -quiet -output "$out" \
			-volid CIDATA -joliet -rock "$seed_dir"
	elif have genisoimage; then
		info "using genisoimage"
		run genisoimage -quiet -output "$out" \
			-volid CIDATA -joliet -rock "$seed_dir"
	elif have mkisofs; then
		info "using mkisofs"
		run mkisofs -quiet -output "$out" \
			-volid CIDATA -joliet -rock "$seed_dir"
	elif have hdiutil; then
		# macOS. hdiutil appends the extension itself, so it is given a base name.
		info "using hdiutil (macOS)"
		base="${out%.iso}"
		run hdiutil makehybrid -quiet -iso -joliet \
			-default-volume-name CIDATA -o "$base" "$seed_dir"
		if [ "$DRY_RUN" -eq 0 ] && [ -f "$base.iso" ] && [ "$base.iso" != "$out" ]; then
			mv -f "$base.iso" "$out"
		fi
	else
		die "no ISO9660 authoring tool found." \
			"One of xorriso, genisoimage, mkisofs or hdiutil is required to build the" \
			"cloud-init seed. Install one:" \
			"" \
			"  macOS          hdiutil ships with macOS; if it is missing, run:" \
			"                 brew install xorriso" \
			"  Debian/Ubuntu  sudo apt-get install -y xorriso" \
			"  Fedora         sudo dnf install -y xorriso" \
			"  Arch           sudo pacman -S libisoburn"
	fi
}

# Copy user-data into the seed, inserting an SSH public key at the marker lines if one
# was supplied. awk rather than sed because key material contains / and + and =, which
# turn sed delimiter choice into a guessing game.
generate_user_data() {
	local src="$1" dst="$2" inserted

	if [ -z "$SSH_KEY_CONTENT" ]; then
		cp "$src" "$dst"
		return 0
	fi

	awk -v key="$SSH_KEY_CONTENT" '
		/^[[:space:]]*# SAIRIOS_SSH_AUTHORIZED_KEYS_MARKER[[:space:]]*$/ {
			match($0, /^[ ]*/)
			indent = substr($0, 1, RLENGTH)
			printf "%sssh_authorized_keys:\n", indent
			printf "%s  - %s\n", indent, key
			next
		}
		{ print }
	' "$src" >"$dst"

	# If the marker was renamed, the key would be silently dropped and the image would
	# build fine and be unreachable. Assert instead.
	inserted="$(grep -c 'ssh_authorized_keys:' "$dst" || true)"
	if [ "${inserted:-0}" -lt 2 ]; then
		die "expected to insert the SSH key at 2 markers, inserted ${inserted:-0}" \
			"The marker comment in vm/cloud-init/user-data.yaml has been renamed or" \
			"removed. Look for SAIRIOS_SSH_AUTHORIZED_KEYS_MARKER."
	fi
}

# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

require_tools

if [ -n "$SSH_KEY_PATH" ]; then
	[ -f "$SSH_KEY_PATH" ] || die "--ssh-key: no such file: $SSH_KEY_PATH"
	SSH_KEY_CONTENT="$(head -n 1 "$SSH_KEY_PATH" | tr -d '\r\n')"
	case "$SSH_KEY_CONTENT" in
	ssh-* | ecdsa-* | sk-*) ;;
	*) die "--ssh-key: $SSH_KEY_PATH does not look like an OpenSSH public key" \
		"Expected a line starting with ssh-ed25519, ssh-rsa, ecdsa-... or sk-..." \
		"Point this at the .pub file, never at a private key." ;;
	esac
	case "$SSH_KEY_CONTENT" in
	*PRIVATE*) die "--ssh-key: that file contains a PRIVATE key. Use the .pub file." ;;
	esac
fi

for f in user-data.yaml meta-data.yaml network-config.yaml; do
	[ -f "$CLOUD_INIT_DIR/$f" ] || die "missing cloud-init source: $CLOUD_INIT_DIR/$f"
done

if [ -f "$WORK_DISK" ] && [ "$FORCE" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
	die "working image already exists: $WORK_DISK" \
		"It may hold a running machine's state. Pass --force to overwrite it, or" \
		"remove it with ./vm/qemu/clean.sh"
fi

# Ask upstream how big the download is. Best effort: a HEAD costs nothing, and dry-run
# must not fail just because the machine is offline.
remote_size() {
	curl -sIL --max-time 15 --proto '=https' "$1" 2>/dev/null |
		awk 'tolower($0) ~ /^content-length:/ { v = $2 } END { gsub(/\r/, "", v); print v }'
}

IMAGE_BYTES="$(remote_size "$IMAGE_URL" || true)"
if [ -z "${IMAGE_BYTES:-}" ]; then
	eval "IMAGE_BYTES=\${APPROX_SIZE_${ARCH}}"
	SIZE_SOURCE="approximate, measured 2026-07-31; upstream unreachable"
else
	SIZE_SOURCE="reported by the server just now"
fi

CACHE_HIT=0
[ -f "$CACHED_IMAGE" ] && CACHE_HIT=1

say ""
say "SairiOS image build plan"
say "------------------------"
say "  guest architecture : $ARCH"
say "  base image         : $IMAGE_URL"
say "  download size      : $(human_bytes "$IMAGE_BYTES")  ($SIZE_SOURCE)"
say "  checksums          : $SUMS_URL  (a few KiB)"
say "  cache              : $CACHED_IMAGE"
if [ "$CACHE_HIT" -eq 1 ]; then
	say "                       CACHED - the image will not be downloaded again"
else
	say "                       NOT CACHED - the full download will happen"
fi
say "  working disk       : $WORK_DISK  (grown to $DISK_SIZE, sparse)"
say "  seed ISO           : $SEED_ISO"
if [ -n "$SSH_KEY_CONTENT" ]; then
	say "  ssh public key     : $SSH_KEY_PATH"
else
	say "  ssh public key     : none - the guest will have NO login access at all."
	say "                       Serial console output only. Pass --ssh-key PATH to"
	say "                       be able to log in and triage."
fi
say ""

if [ "$DRY_RUN" -eq 1 ]; then
	say "DRY RUN. Nothing below is executed and nothing is written."
	say ""
	if [ "$CACHE_HIT" -eq 1 ]; then
		say "  Total bytes that would be downloaded: a few KiB (checksums only)."
	else
		say "  Total bytes that would be downloaded: $(human_bytes "$IMAGE_BYTES") plus a few KiB."
	fi
fi

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
# Only gate on a real download. Re-running against a warm cache should not need a
# keystroke.

if [ "$DRY_RUN" -eq 0 ] && [ "$CACHE_HIT" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
	if [ -t 0 ]; then
		printf 'Download %s from cloud.debian.org? [y/N] ' "$(human_bytes "$IMAGE_BYTES")"
		read -r reply
		case "$reply" in
		[yY] | [yY][eE][sS]) ;;
		*) die "aborted by the user" ;;
		esac
	else
		die "refusing to download $(human_bytes "$IMAGE_BYTES") without confirmation." \
			"stdin is not a terminal, so there is nobody to ask." \
			"Pass --yes to proceed non-interactively."
	fi
fi

# ---------------------------------------------------------------------------
# 1. Directories
# ---------------------------------------------------------------------------

step "Preparing directories"
run mkdir -p "$CACHE_DIR" "$OUT_DIR"

# ---------------------------------------------------------------------------
# 2. Checksums
# ---------------------------------------------------------------------------

step "Fetching $SUMS_NAME"
info "$SUMS_URL"
run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 \
	--max-time 120 --silent --show-error \
	--output "$CACHED_SUMS" "$SUMS_URL"

EXPECTED_HASH=""
if [ "$DRY_RUN" -eq 0 ]; then
	# SHA512SUMS lines are "<128 hex>  <filename>". awk splits on whitespace, so $2 is
	# the bare filename. `sha512sum -c` is avoided: the file lists dozens of artifacts
	# that are not present locally, and the --ignore-missing flag needed to cope with
	# that does not exist in every implementation.
	EXPECTED_HASH="$(awk -v f="$IMAGE_NAME" '$2 == f { print $1; exit }' "$CACHED_SUMS")"
	[ -n "$EXPECTED_HASH" ] ||
		die "$IMAGE_NAME does not appear in $SUMS_NAME" \
			"Debian may have changed its image naming, or the download was truncated." \
			"Inspect: $CACHED_SUMS"
	info "expected sha512: ${EXPECTED_HASH:0:32}..."

	if [ -n "$EXPECT_SHA512" ] && [ "$EXPECT_SHA512" != "$EXPECTED_HASH" ]; then
		die "--expect-sha512 does not match the published checksum." \
			"  pinned    : $EXPECT_SHA512" \
			"  published : $EXPECTED_HASH" \
			"" \
			"Debian has rebuilt the image since that pin was taken, or the pin is wrong." \
			"Verify deliberately before updating it."
	fi
else
	info "would read the expected digest for $IMAGE_NAME out of $SUMS_NAME"
fi

# ---------------------------------------------------------------------------
# 3. Base image, downloaded once and verified every time
# ---------------------------------------------------------------------------

verify_cached() {
	local actual
	actual="$(sha512_of "$CACHED_IMAGE")"
	[ "$actual" = "$EXPECTED_HASH" ]
}

step "Base image"
if [ "$DRY_RUN" -eq 1 ]; then
	if [ "$CACHE_HIT" -eq 1 ]; then
		info "would re-verify the cached image at $CACHED_IMAGE"
	else
		info "would download $(human_bytes "$IMAGE_BYTES") from $IMAGE_URL"
		info "would verify its sha512 against $SUMS_NAME and delete it on mismatch"
	fi
else
	NEED_DOWNLOAD=1
	if [ -f "$CACHED_IMAGE" ]; then
		info "cached copy found, verifying before reuse"
		if verify_cached; then
			info "cached image checksum matches; skipping download"
			NEED_DOWNLOAD=0
		else
			warn "cached image FAILED verification; it will be re-downloaded"
			warn "(Debian usually rebuilds the image rather than corrupting it)"
			rm -f "$CACHED_IMAGE"
		fi
	fi

	if [ "$NEED_DOWNLOAD" -eq 1 ]; then
		info "downloading $(human_bytes "$IMAGE_BYTES") ..."
		# Download to .part so an interrupted transfer can never be mistaken for a
		# complete, verified image. --continue-at - resumes a partial file.
		curl --fail --location --proto '=https' --tlsv1.2 \
			--retry 3 --retry-delay 2 --continue-at - \
			--output "$CACHED_IMAGE.part" "$IMAGE_URL"

		info "verifying sha512 ..."
		ACTUAL_HASH="$(sha512_of "$CACHED_IMAGE.part")"
		if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
			rm -f "$CACHED_IMAGE.part"
			die "CHECKSUM MISMATCH - the downloaded image was discarded." \
				"  expected : $EXPECTED_HASH" \
				"  actual   : $ACTUAL_HASH" \
				"" \
				"Do not work around this. Either the download was corrupted, or the" \
				"artifact you received is not the one Debian published. Re-run; if it" \
				"fails again, stop and investigate the network path."
		fi
		mv -f "$CACHED_IMAGE.part" "$CACHED_IMAGE"
		info "verified and cached"
	fi
fi

# ---------------------------------------------------------------------------
# 4. Working copy
# ---------------------------------------------------------------------------

step "Creating the working disk"
info "$CACHED_IMAGE -> $WORK_DISK"
run rm -f "$WORK_DISK"
run cp "$CACHED_IMAGE" "$WORK_DISK"

info "growing to $DISK_SIZE"
# The base image has a ~2 GiB virtual disk, which does not fit Node, cage, cog and the
# WebKit stack. qcow2 is sparse, so a 20G virtual disk costs only what is written.
run qemu-img resize "$WORK_DISK" "$DISK_SIZE"

# The guest's partition table and filesystem are grown on first boot by cloud-init's
# growpart and resizefs modules, which the Debian cloud image enables by default. That is
# why nothing here touches the partition table.

# ---------------------------------------------------------------------------
# 5. Seed ISO
# ---------------------------------------------------------------------------

step "Building the cloud-init seed ISO"

SEED_TMP=""
# Must always succeed. An EXIT trap whose last command fails changes the script's exit
# status, which would make a perfectly good dry run report failure.
cleanup() {
	if [ -n "${SEED_TMP:-}" ] && [ -d "$SEED_TMP" ]; then
		rm -rf "$SEED_TMP"
	fi
	return 0
}
trap cleanup EXIT INT TERM

if [ "$DRY_RUN" -eq 1 ]; then
	info "would stage into a temporary directory:"
	info "  vm/cloud-init/user-data.yaml       -> user-data"
	info "  vm/cloud-init/meta-data.yaml       -> meta-data"
	info "  vm/cloud-init/network-config.yaml  -> network-config"
	if [ -n "$SSH_KEY_CONTENT" ]; then
		info "  inserting the public key from $SSH_KEY_PATH at both markers"
	fi
	info "would build $SEED_ISO with volume label CIDATA"
	build_seed_iso "<staging-dir>" "$SEED_ISO"
else
	SEED_TMP="$(mktemp -d "${TMPDIR:-/tmp}/sairios-seed.XXXXXX")"
	generate_user_data "$CLOUD_INIT_DIR/user-data.yaml" "$SEED_TMP/user-data"
	cp "$CLOUD_INIT_DIR/meta-data.yaml" "$SEED_TMP/meta-data"
	cp "$CLOUD_INIT_DIR/network-config.yaml" "$SEED_TMP/network-config"
	chmod 0644 "$SEED_TMP"/*

	rm -f "$SEED_ISO"
	build_seed_iso "$SEED_TMP" "$SEED_ISO"
	[ -f "$SEED_ISO" ] || die "the ISO tool reported success but $SEED_ISO does not exist"
	info "seed ISO: $(human_bytes "$(wc -c <"$SEED_ISO" | tr -d ' ')")"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

step "Done"
if [ "$DRY_RUN" -eq 1 ]; then
	say "    Dry run complete. Nothing was downloaded and nothing was written."
	say ""
	say "    Re-run without --dry-run to build:"
	say "      ./vm/qemu/build-image.sh --arch $ARCH --yes"
	exit 0
fi

say "    disk : $WORK_DISK"
say "    seed : $SEED_ISO"
say ""
say "    Next:"
say "      ./vm/qemu/run-vm.sh --arch $ARCH             # graphical"
say "      ./vm/qemu/run-vm-headless.sh --arch $ARCH --smoke"
say ""
say "    The image contains the operating-system layer only. /opt/sairios is empty and"
say "    the first-boot report will say DEGRADED until SairiOS is delivered. That is"
say "    expected. See vm/cloud-init/README.md."
