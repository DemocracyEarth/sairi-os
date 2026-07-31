# vm/cloud-init/

The first-boot provisioning for a SairiOS VM. Three YAML files that become a NoCloud
seed ISO, plus this explanation.

Nothing here has ever been executed. See "Verification status" at the bottom before
trusting any of it.

## What a NoCloud seed is

The Debian cloud image ships cloud-init and no configuration. On first boot cloud-init
looks for a datasource. In a real cloud that is a metadata service on a link-local
address. Locally, the `NoCloud` datasource does the same job from a small filesystem
attached to the VM.

`vm/qemu/build-image.sh` builds that filesystem: an ISO9660 image whose **volume label is
`CIDATA`**, containing three files at the root. The label is how cloud-init finds it, and
the filenames are fixed:

| Source in this directory | Name inside the ISO | Required                  |
| ------------------------ | ------------------- | ------------------------- |
| `user-data.yaml`         | `user-data`         | yes                       |
| `meta-data.yaml`         | `meta-data`         | yes, even if nearly empty |
| `network-config.yaml`    | `network-config`    | no                        |

The `.yaml` extensions exist only so editors and `prettier` treat them as YAML. They are
dropped when the seed is built. A file named `user-data.yaml` inside the ISO is ignored,
and the symptom is a machine that boots to a stock Debian login prompt with none of the
SairiOS provisioning applied.

The ISO is attached as a read-only virtio disk (`/dev/vdb` in the guest), not as a CD.
The `virt` machine type used for arm64 has no IDE or SATA controller, so attaching it as
a CD-ROM would work on amd64 and silently fail on arm64. One code path for both.

## The files

### `user-data.yaml`

The substance: accounts, packages, Node.js, filesystem layout, unit installation and the
boot self-check. It is heavily commented inline; read it rather than a paraphrase.

Four things about it are worth stating separately because they are decisions, not
details.

**There are two accounts and the asymmetry is the point.** `sairi` runs the session and
the four services, has no password and **no sudo at all**. `debian` exists only for
triage, has a locked password and NOPASSWD sudo, and is unreachable without an SSH key
that this repository does not contain. An agent that escaped the permission broker would
be running as `sairi`, which is an account with nothing to escalate to.

**No credentials, ever.** No passwords, no API keys, no tokens. `OPENCLAW_GATEWAY_TOKEN`
and `SAIRIOS_LLM_API_KEY` in particular are never baked into an image; they belong in
`/home/sairi/.config/sairios/env` (mode 0600, owner `sairi`) on a running machine, which
`user-data.yaml` creates as an empty commented template. An image gets copied, shared and
archived. A runtime file does not. SairiOS boots fully in `mock` mode with no credentials
of any kind, so the default image needs none.

**The image is bare.** Provisioning installs the operating-system layer and creates
`/opt/sairios` owned by `sairi`, but it does not put SairiOS in it. There is no `git
clone` and no baked-in build. A freshly built image reports `DEGRADED` on purpose. See
"Delivering SairiOS" below.

**`package_upgrade` is false.** It would add minutes to every first boot and make two
builds of the same image differ by when they ran. Upgrade a running machine instead.

### `meta-data.yaml`

Almost empty, and the one line that matters is `instance-id`. cloud-init compares it
against `/var/lib/cloud/instance-id` on every boot. Same id means reboot, and the
per-instance modules (users, packages, `runcmd`, `write_files`) are **skipped**.

The practical consequence catches everyone once: **editing `user-data.yaml` and rebooting
the same disk changes nothing.** To pick up an edit, either build a fresh disk, or bump
`instance-id`, or run inside the guest:

```sh
sudo cloud-init clean --logs
sudo reboot
```

A fresh disk from `make vm-image` is the honest way to test a provisioning change,
because it is the only one that tests the path a new user takes.

### `network-config.yaml`

DHCP on whatever the interface is called, IPv6 off, `optional: true` so nothing waits on
it. IPv6 is disabled because QEMU's user-mode stack answers router solicitations in a way
that leaves the guest sitting at `A start job is running for Wait for Network` for up to
two minutes. On a serial console that is indistinguishable from a hang, and it is the
most common false "the VM is broken" report.

## Delivering SairiOS to a provisioned machine

The image ships the OS layer. SairiOS itself is delivered separately, which keeps image
builds independent of product builds and means a broken product build cannot produce an
unbootable image.

Build on the host, copy in, provision, reboot:

```sh
# On the host, from the repository root.
npm ci && npm run build

# Requires that the image was built with --ssh-key, and the VM is running.
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude var \
  -e 'ssh -p 22022' ./ debian@127.0.0.1:/tmp/sairios/

ssh -p 22022 debian@127.0.0.1 '
  sudo rsync -a /tmp/sairios/ /opt/sairios/ &&
  sudo chown -R sairi:sairi /opt/sairios &&
  sudo /usr/local/sbin/sairios-provision &&
  sudo reboot'
```

`sairios-provision` is idempotent and runs on every boot. It installs the four user units
into `/etc/systemd/user/`, the session unit into `/etc/systemd/system/`, the desktop entry
and the branding assets, then enables everything. On a machine with no product tree it
logs that fact and exits 0, because "provisioned but empty" is a valid state and should
not look like a failure.

Note that `node_modules` is excluded above, so `/opt/sairios` needs its dependencies
installed in the guest (`npm ci --omit=dev`) before the services can start. Copying
`node_modules` from an arm64 macOS host to an amd64 Linux guest would ship native
binaries for the wrong platform, which fails in a confusing way. Let the guest resolve
its own.

## Reading the boot report

Every boot writes `/var/log/sairios-firstboot.log` and repeats it on the serial console.
The previous report is kept as `.log.1`.

The last verdict line is machine-readable and is what `vm/qemu/run-vm-headless.sh
--smoke` greps for:

| Verdict                       | Meaning                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `SAIRIOS-FIRSTBOOT: OK`       | Everything present and answering. Requires a delivered product tree.                                |
| `SAIRIOS-FIRSTBOOT: DEGRADED` | The OS layer provisioned correctly; SairiOS is not running. **Expected for a freshly built image.** |
| `SAIRIOS-FIRSTBOOT: FAIL`     | The OS layer itself is broken. Something in this directory is wrong.                                |

The distinction is the whole design of the check. A bare image is not a broken image, and
conflating the two would make the smoke test either useless or permanently red.

## Verification status

Never executed. The authoring host was macOS on arm64 with no QEMU, no Docker and no
cloud-init, so none of this has been booted.

| Item                                                   | Status                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| YAML parses                                            | **Verified.** All three files parse with a YAML 1.2 parser.                                                                                                                                                                                                                          |
| Embedded shell scripts parse                           | **Verified.** All three pass `bash -n`.                                                                                                                                                                                                                                              |
| `sairios-firstboot-check` logic executed               | **Partially verified.** Run on the macOS authoring host with paths redirected. Section rendering, counter arithmetic and verdict selection are correct. Every Linux-specific probe reported failure there, which is the right answer on macOS and says nothing about a Debian guest. |
| Package names exist in Debian 12                       | **Verified against the archive on 2026-07-31.** cage 0.1.4-4, cog 0.16.1-1, seatd 0.7.0-6, pipewire 0.3.65-3+deb12u1, wireplumber 0.4.13-1, fonts-inter, fonts-jetbrains-mono, fonts-liberation2. Presence in the archive is not the same as installing cleanly together.            |
| `cloud-init schema` validation                         | **Not run.** cloud-init is not installed on the authoring host.                                                                                                                                                                                                                      |
| Booted in a VM                                         | **Not run.** No QEMU.                                                                                                                                                                                                                                                                |
| NodeSource repository reachable and signed as expected | **Not run.**                                                                                                                                                                                                                                                                         |
| Seed ISO built and detected by cloud-init              | **Not run.**                                                                                                                                                                                                                                                                         |

To verify on a machine that has the tools:

```sh
# Schema validation. Needs cloud-init installed; no VM required.
cloud-init schema --config-file vm/cloud-init/user-data.yaml

# Shell lint of the embedded scripts, which shellcheck cannot see through YAML.
# Extract them first, or read them in the file.
shellcheck -s bash <(sed -n '/#!\/usr\/bin\/env bash/,/^$/p' vm/cloud-init/user-data.yaml)

# The real test.
./vm/qemu/build-image.sh --arch arm64 --yes
./vm/qemu/run-vm-headless.sh --arch arm64 --smoke
```

Correct output from the smoke run is a serial log containing
`SAIRIOS-FIRSTBOOT: DEGRADED` and an exit status of 0. `OK` is not expected until a
product tree has been delivered.
