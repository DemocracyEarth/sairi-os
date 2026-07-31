#!/usr/bin/env bash
#
# Remove VM build artifacts.
#
# By default this removes vm/out/ only. It does NOT touch vm/.cache/, which holds the
# verified Debian base images. Those are ~330 MiB each and re-downloading them is the
# slowest step in the whole build, so deleting them has to be asked for explicitly.
#
#   ./vm/qemu/clean.sh              remove vm/out/
#   ./vm/qemu/clean.sh --all        remove vm/out/ AND vm/.cache/
#   ./vm/qemu/clean.sh --dry-run    list what would be removed
#
# This script deletes things, so it is deliberately paranoid about where it is pointed.
# Every path is resolved and checked to be inside the repository before anything is
# removed, and the repository itself has to look like SairiOS.

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly SCRIPT_DIR REPO_ROOT

DRY_RUN=0
ALL=0

say() { printf '%s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

die() {
	printf '\nclean.sh: error: %s\n' "$1" >&2
	shift
	for line in "$@"; do printf '  %s\n' "$line" >&2; done
	exit 1
}

usage() {
	cat <<'EOF'
Remove SairiOS VM build artifacts.

  --all       Also remove vm/.cache/, the verified base images (~330 MiB each).
              They will have to be downloaded again.
  --dry-run   List what would be removed. Delete nothing.
  --help, -h  This message.

Default: remove vm/out/ only.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--all) ALL=1 && shift ;;
	--dry-run) DRY_RUN=1 && shift ;;
	--help | -h)
		usage
		exit 0
		;;
	*) die "unknown option: $1" "run --help for usage" ;;
	esac
done

# ---------------------------------------------------------------------------
# Refuse to operate outside the repository
# ---------------------------------------------------------------------------

# 1. The root must look like this project. Without this check, a copy of the script
#    dropped somewhere else would happily delete that place's vm/out.
if [ ! -f "$REPO_ROOT/package.json" ] ||
	! grep -q '"name": *"sairios"' "$REPO_ROOT/package.json"; then
	die "refusing to run: $REPO_ROOT does not look like the sairios repository" \
		"Expected a package.json there naming the project \"sairios\"."
fi

# 2. Guard against a repository root that is somewhere catastrophic. This should be
#    impossible given the check above, which is exactly why it is cheap to also check.
case "$REPO_ROOT" in
/ | /home | /Users | /root | /tmp | /var)
	die "refusing to run: repository root resolved to '$REPO_ROOT'"
	;;
esac
if [ "$REPO_ROOT" = "${HOME:-}" ]; then
	die "refusing to run: repository root resolved to your home directory"
fi

# 3. Resolve a directory and confirm it is genuinely inside the repository. Resolution
#    happens with `cd ... && pwd -P`, which follows symlinks, so a symlinked vm/out
#    pointing at /etc is caught here rather than after the fact.
assert_inside_repo() {
	local path="$1" resolved

	case "$path" in
	*..*) die "refusing to operate on a path containing '..': $path" ;;
	esac

	[ -d "$path" ] || return 0

	resolved="$(CDPATH='' cd -- "$path" && pwd -P)"
	case "$resolved" in
	"$REPO_ROOT"/vm/*) ;;
	*)
		die "refusing to delete $path" \
			"It resolves to $resolved, which is not inside $REPO_ROOT/vm/." \
			"If vm/out or vm/.cache is a symlink pointing elsewhere, remove it by hand."
		;;
	esac
}

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

OUT_DIR="$REPO_ROOT/vm/out"
CACHE_DIR="$REPO_ROOT/vm/.cache"
readonly OUT_DIR CACHE_DIR

TARGETS=("$OUT_DIR")
[ "$ALL" -eq 1 ] && TARGETS+=("$CACHE_DIR")

for t in "${TARGETS[@]}"; do
	assert_inside_repo "$t"
done

dir_size() {
	if [ -d "$1" ]; then
		du -sh "$1" 2>/dev/null | awk '{print $1}'
	else
		printf '0'
	fi
}

# ---------------------------------------------------------------------------
# Report and remove
# ---------------------------------------------------------------------------

say ""
say "SairiOS VM clean"
say "----------------"

ANYTHING=0
for t in "${TARGETS[@]}"; do
	if [ -d "$t" ]; then
		ANYTHING=1
		say "  ${t}  ($(dir_size "$t"))"
		if [ "$DRY_RUN" -eq 1 ]; then
			find "$t" -maxdepth 1 -mindepth 1 -print 2>/dev/null |
				sed 's|^|      |' || true
		fi
	else
		say "  ${t}  (does not exist)"
	fi
done

if [ "$ALL" -eq 0 ]; then
	say ""
	if [ -d "$CACHE_DIR" ]; then
		say "  KEPT: $CACHE_DIR ($(dir_size "$CACHE_DIR"))"
		say "        Verified base images. Pass --all to remove them and pay for the"
		say "        download again."
	fi
fi

say ""

if [ "$ANYTHING" -eq 0 ]; then
	say "  Nothing to remove."
	exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
	say "  DRY RUN. Nothing was deleted."
	exit 0
fi

for t in "${TARGETS[@]}"; do
	if [ -d "$t" ]; then
		rm -rf -- "$t"
		info "removed $t"
	fi
done

say ""
say "  Done. Rebuild with:  ./vm/qemu/build-image.sh --arch <arch> --yes"
