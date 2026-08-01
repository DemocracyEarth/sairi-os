#!/usr/bin/env bash
#
# Deliver the SairiOS tree into a running guest and provision it.
#
# The image build produces the operating-system layer only; /opt/sairios is empty
# on purpose, so image builds stay independent of product builds. This is the
# other half: copy the repository in, install and build it there, then run
# sairios-provision to install the systemd units.
#
# Requires a guest booted with an SSH key (build with --ssh-key) and reachable on
# the forwarded port. Run ./vm/qemu/run-vm-headless.sh first, in another terminal.
#
# Usage:
#   ./vm/qemu/deliver.sh [--key PATH] [--port 22022] [--host 127.0.0.1]

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

if [ ! -f "$REPO_ROOT/package.json" ] || ! grep -q '"name": *"sairios"' "$REPO_ROOT/package.json"; then
	printf 'deliver.sh: refusing to run: %s is not the sairios repository\n' "$REPO_ROOT" >&2
	exit 1
fi

KEY="$REPO_ROOT/vm/out/sairios_dev_key"
PORT=22022
HOST=127.0.0.1

while [ $# -gt 0 ]; do
	case "$1" in
	--key) KEY="${2:?--key needs a path}" && shift 2 ;;
	--port) PORT="${2:?--port needs a value}" && shift 2 ;;
	--host) HOST="${2:?--host needs a value}" && shift 2 ;;
	--help | -h)
		sed -n '2,15p' "$0"
		exit 0
		;;
	*)
		printf 'deliver.sh: unknown option %s\n' "$1" >&2
		exit 1
		;;
	esac
done

[ -f "$KEY" ] || {
	printf 'deliver.sh: no SSH key at %s\n' "$KEY" >&2
	printf '  Build the image with --ssh-key so the guest accepts one.\n' >&2
	exit 1
}

# Host key checking is off on purpose: the guest is a disposable local VM whose
# key changes on every rebuild, and it is reached over a loopback port forward.
SSH_OPTS=(-p "$PORT" -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
remote() { ssh "${SSH_OPTS[@]}" "debian@$HOST" "$@"; }

step() { printf '\n==> %s\n' "$*"; }

step 'Waiting for cloud-init to finish'
# Delivering into a half-provisioned machine produces failures that look like
# product bugs. `cloud-init status --wait` blocks until the run is over.
remote 'cloud-init status --wait >/dev/null 2>&1 || true; cloud-init status' || true
remote 'command -v node >/dev/null' || {
	printf '\ndeliver.sh: node is not installed in the guest.\n' >&2
	printf '  The Node step of cloud-init did not complete. Check the serial log for\n' >&2
	printf '  "sairios: Node step ABORTED".\n' >&2
	exit 1
}
printf '    node %s\n' "$(remote 'node --version')"

step 'Copying the repository to /tmp/sairios'
# /opt/sairios is root-owned (a privilege boundary: sairios-provision installs
# systemd units from it), so the copy lands in /tmp first and root moves it.
rsync -a --delete \
	--exclude '.git' \
	--exclude 'node_modules' \
	--exclude 'vm/out' \
	--exclude 'vm/.cache' \
	--exclude 'var' \
	--exclude 'dist' \
	--exclude 'dist-types' \
	--exclude '*.tsbuildinfo' \
	-e "ssh ${SSH_OPTS[*]}" \
	"$REPO_ROOT/" "debian@$HOST:/tmp/sairios/"

step 'Installing into /opt/sairios'
remote 'sudo rsync -a --delete /tmp/sairios/ /opt/sairios/ && sudo chown -R root:root /opt/sairios'

step 'Installing dependencies (full install: vite is needed to serve the shell)'
remote 'cd /opt/sairios && sudo npm ci --no-audit --no-fund 2>&1 | tail -3'

step 'Building'
remote 'cd /opt/sairios && sudo npm run build 2>&1 | tail -5'

step 'Provisioning systemd units'
remote 'sudo /usr/local/sbin/sairios-provision'

step 'Starting the SairiOS user services'
remote 'sudo loginctl enable-linger sairi || true'
remote 'sudo -u sairi XDG_RUNTIME_DIR=/run/user/$(id -u sairi) systemctl --user daemon-reload || true'
for unit in context-service permission-broker agent-bridge shell; do
	remote "sudo -u sairi XDG_RUNTIME_DIR=/run/user/\$(id -u sairi) systemctl --user restart sairios-$unit.service || true"
done

step 'Checking the services'
sleep 8
remote 'for p in 7800 7801 7802 7803; do
  if curl -sS -o /dev/null --max-time 4 "http://127.0.0.1:$p/" 2>/dev/null || \
     curl -sS -o /dev/null --max-time 4 "http://127.0.0.1:$p/healthz" 2>/dev/null; then
    echo "  ok   $p answering"
  else
    echo "  FAIL $p not answering"
  fi
done'

step 'Done'
printf '    Reboot the guest to bring up the graphical session:\n'
printf '      ssh -p %s -i %s debian@%s sudo reboot\n' "$PORT" "$KEY" "$HOST"
printf '    Then run ./vm/qemu/run-vm.sh to watch it come up with a display.\n'
