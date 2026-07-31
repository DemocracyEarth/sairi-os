# vm/

Everything needed to build and boot SairiOS as a virtual machine: the cloud-init
provisioning, the QEMU wrapper scripts, and the caches they produce.

Read "Unverified" at the bottom before you trust any of this. The short version is that
these scripts have never been executed, because the machine they were written on has no
QEMU.

## Layout

| Path                      | What                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `cloud-init/`             | First-boot provisioning. Becomes a NoCloud seed ISO. See its README.           |
| `qemu/build-image.sh`     | Downloads and verifies the base image, builds disk + seed.                     |
| `qemu/run-vm.sh`          | Boots it with a graphical display.                                             |
| `qemu/run-vm-headless.sh` | Boots it on a serial console; `--smoke` is the CI check.                       |
| `qemu/clean.sh`           | Removes artifacts. Keeps the download cache unless `--all`.                    |
| `.cache/`                 | Verified Debian base images. Git-ignored. Expensive. Not auto-deleted.         |
| `out/`                    | Working disk, seed ISO, firmware copies, serial logs. Git-ignored. Disposable. |

## Commands

Run everything from the repository root. The `make` targets are thin wrappers over
exactly these.

```sh
# Look before you leap. Prints every step and every byte, downloads nothing.
./vm/qemu/build-image.sh --dry-run

# Build. Defaults to the host architecture. --yes skips the download confirmation.
./vm/qemu/build-image.sh --yes

# Build for the other architecture, and install a public key so you can log in.
./vm/qemu/build-image.sh --arch amd64 --yes --ssh-key ~/.ssh/id_ed25519.pub

# Boot with a window.
./vm/qemu/run-vm.sh

# Boot on this terminal's serial console. Ctrl-A then X to quit.
./vm/qemu/run-vm-headless.sh

# The CI check. Exits non-zero if the guest never reports, or reports failure.
./vm/qemu/run-vm-headless.sh --smoke

# Clean up. vm/.cache/ survives this.
./vm/qemu/clean.sh
./vm/qemu/clean.sh --all      # ... and this removes the cache too
```

Every script takes `--dry-run` and `--help`.

## Sizes, caches and what gets downloaded

The base image is downloaded once per architecture into `vm/.cache/` and reused. It is
verified against Debian's published `SHA512SUMS` on every use, including cache hits, so a
corrupted cache is caught rather than silently baked into an image.

Measured against `cloud.debian.org` on 2026-07-31, when `latest/` pointed at the
`20260722-2547` build:

| Artifact                             | Size                                                                    | Where        |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------ |
| `debian-12-genericcloud-amd64.qcow2` | 348,913,664 B (332.8 MiB)                                               | `vm/.cache/` |
| `debian-12-genericcloud-arm64.qcow2` | 339,607,552 B (323.9 MiB)                                               | `vm/.cache/` |
| `SHA512SUMS`                         | a few KiB, fetched every build                                          | `vm/.cache/` |
| Seed ISO                             | ~900 KiB as built by `hdiutil`; smaller with `xorriso`                  | `vm/out/`    |
| Working disk                         | 20 GiB virtual, sparse. A provisioned guest is roughly 2–3 GiB on disk. | `vm/out/`    |
| aarch64 pflash copies                | 64 MiB each, two of them                                                | `vm/out/`    |

The working-disk figure is an estimate and is the only number in that table nobody has
observed. `clean.sh` deliberately keeps the cache: `vm/out/` is cheap to rebuild and
`vm/.cache/` is not.

`latest/` is a symlink that Debian moves on each point release, so checksums are fetched
at build time rather than pinned in the script. Pin a specific build with
`--expect-sha512 <hex>` if you need byte-for-byte reproducibility; the build refuses to
proceed if the published checksum has moved away from your pin.

## Acceleration matrix

Hardware acceleration requires the guest architecture to equal the host architecture.
This is not a QEMU flag anyone forgot: KVM and HVF both execute guest instructions on the
physical CPU, so a different instruction set has to be interpreted.

| Host                | Guest `arm64` | Guest `amd64` |
| ------------------- | ------------- | ------------- |
| Linux x86_64        | TCG, slow     | **KVM, fast** |
| Linux aarch64       | **KVM, fast** | TCG, slow     |
| macOS Apple Silicon | **HVF, fast** | TCG, slow     |
| macOS Intel         | TCG, slow     | **HVF, fast** |
| anything else       | TCG           | TCG           |

The scripts detect this and print which accelerator they chose. When they fall back to
TCG they say so loudly, and when the cause is an architecture mismatch they name the
architecture you should have asked for instead.

### The cross-architecture caveat, stated plainly

TCG works. It is correct. It is roughly an order of magnitude slower than hardware
acceleration, and a first boot under TCG installs packages through an interpreter. Expect
minutes, not seconds. It is a fine way to check that an image boots on the other
architecture before a release; it is not a development loop.

Practical consequences:

- On Apple Silicon, build and run `--arch arm64`. On Linux x86_64, `--arch amd64`.
- SairiOS therefore ships and tests **both** architectures. That is not a nice-to-have;
  it is what gives contributors on either host a usable loop.
- For a smoke test across architectures, raise the bound: `--smoke --timeout 2400`. The
  default 600s will time out under TCG, and the script warns about this before it starts.

On Linux, `/dev/kvm` frequently exists but is not openable by your user. The script
checks for read **and** write access rather than mere existence, so this shows up as a
TCG warning at startup with the `usermod -aG kvm` fix printed, instead of a permission
error several seconds into the boot.

## Reaching the guest from the host

Port forwarding binds host loopback only, always: `hostfwd=tcp:127.0.0.1:...`. Without
the explicit address QEMU binds `0.0.0.0` and offers the VM's SSH port to the whole local
network.

Forwarded by default: guest `22` to `127.0.0.1:22022`.

**The SairiOS ports cannot be reached by port forwarding, and this trips people up.**
QEMU's user-mode networking forwards to the guest's DHCP address (`10.0.2.15`), but every
SairiOS service binds `127.0.0.1` inside the guest. A forwarded connection therefore
arrives at an address nothing is listening on. `--forward-shell` exists, adds the rule,
and prints this explanation, because a rule that appears to work and does not is worse
than no rule.

Use an SSH tunnel, which terminates inside the guest and so does reach loopback:

```sh
ssh -N -L 7800:127.0.0.1:7800 -p 22022 debian@127.0.0.1
# then open http://127.0.0.1:7800 on the host
```

That needs an image built with `--ssh-key`. Without one the guest has no login access at
all by design, and the serial console is the only channel.

## The image is bare on purpose

`build-image.sh` produces a provisioned operating-system layer with an **empty**
`/opt/sairios`. It does not clone the repository and does not bake a build into the
image. A freshly built image reports `SAIRIOS-FIRSTBOOT: DEGRADED`, and that is a pass.

This keeps image builds independent of product builds, so a broken `npm run build` cannot
produce an unbootable image. See `vm/cloud-init/README.md` for how to deliver SairiOS to
a running machine.

## Unverified

**Nothing in this directory has ever been executed against a real virtual machine.**

The authoring host was macOS 26 on arm64. It has no QEMU, no `qemu-img`, no Docker, no
systemd and no cloud-init. No image has been downloaded, no disk has been built by
`qemu-img`, no VM has been booted, no accelerator has been exercised, no firmware has
been loaded, no guest has reached a serial console, and no smoke test has ever passed
against a real guest.

Do not read the detail in these scripts as evidence that they work. It is evidence that
they were written carefully, which is a different thing.

### What was verified, and how

Some of it could be checked without QEMU, and was. This list is exact.

| Claim                                                                                                                                                                           | How it was checked                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Base image URLs resolve; sizes as tabled above                                                                                                                                  | HTTP HEAD against `cloud.debian.org`                                                                                                          |
| `SHA512SUMS` format is `<hash>␠␠<filename>` and lists the genericcloud qcow2                                                                                                    | Fetched and parsed                                                                                                                            |
| Every package in `user-data.yaml` exists in bookworm                                                                                                                            | Queried the Debian source index                                                                                                               |
| All five scripts are syntactically valid bash                                                                                                                                   | `bash -n`                                                                                                                                     |
| All three cloud-init YAML files parse                                                                                                                                           | YAML 1.2 parser                                                                                                                               |
| The three shell scripts embedded in `user-data.yaml` parse                                                                                                                      | Extracted, then `bash -n`                                                                                                                     |
| `--ssh-key` injection produces valid YAML attaching the key to both accounts                                                                                                    | Ran the awk, re-parsed the result                                                                                                             |
| Seed ISO builds, is labelled `CIDATA`, and carries **lowercase** `user-data`, `meta-data`, `network-config`                                                                     | Built a real ISO with `hdiutil`, then read the ISO9660 primary and Joliet volume descriptors directly                                         |
| aarch64 pflash padding yields exactly 67,108,864 bytes with the firmware intact at offset 0 and zero padding after                                                              | Ran it on a 2 MiB stand-in, compared hashes, counted non-zero bytes in the tail                                                               |
| `--dry-run` on all four scripts writes nothing and exits 0                                                                                                                      | Executed                                                                                                                                      |
| Missing-tool, bad-arch, unknown-flag, missing-image and missing-firmware paths produce a legible message and a non-zero exit                                                    | Executed each                                                                                                                                 |
| All seven `--smoke` outcomes (OK, DEGRADED, DEGRADED+`--strict`, FAIL, unrecognised verdict, QEMU died, timeout) return the documented exit codes and leave no orphan processes | Executed against a stand-in QEMU that writes a synthetic serial log                                                                           |
| `clean.sh` keeps `vm/.cache/` by default, removes it with `--all`, and refuses a `vm/out` symlinked outside the repository or a repository that is not SairiOS                  | Executed, including the symlink-escape attempt                                                                                                |
| `sairios-firstboot-check` renders its sections, counts correctly and selects a verdict                                                                                          | Executed on macOS with paths redirected. Every Linux-specific probe correctly reported failure there, which says nothing about a Debian guest |

The `CIDATA` and pflash findings are worth singling out, because both are silent-failure
modes. An ISO whose filenames got upper-cased boots to a stock Debian with no SairiOS and
no error; an unpadded pflash image makes QEMU refuse to start with a message about byte
counts.

### The Joliet detail, since it decides whether any of this works

ISO9660 upper-cases filenames. cloud-init needs lowercase `user-data`. The seed is
therefore built with Joliet (`hdiutil -joliet`) or Rock Ridge (`xorriso -rock`), both of
which preserve case, and the built ISO was inspected to confirm the lowercase names are
present and no upper-case Joliet variants exist. Linux's `isofs` driver prefers Rock
Ridge, falls back to Joliet, and lower-cases plain ISO names as a last resort, so all
three paths land on `user-data`. Removing `-joliet`/`-rock` from the ISO command would
break the image silently.

### Verifying this yourself

On a host with QEMU installed, in order. Each step is cheap and the failures are
distinguishable.

```sh
# 1. No network, no writes. Should print a plan and exit 0.
./vm/qemu/build-image.sh --dry-run
./vm/qemu/run-vm.sh --dry-run
./vm/qemu/run-vm-headless.sh --smoke --dry-run
./vm/qemu/clean.sh --dry-run

# 2. Lint. Not installed on the authoring host, so this has never run.
shellcheck vm/qemu/*.sh

# 3. Validate the cloud-config. Needs cloud-init; no VM required.
cloud-init schema --config-file vm/cloud-init/user-data.yaml

# 4. Build. ~330 MiB the first time, cached afterwards.
./vm/qemu/build-image.sh --yes --ssh-key ~/.ssh/id_ed25519.pub

# 5. The real test.
./vm/qemu/run-vm-headless.sh --smoke
```

What correct output looks like:

- **Step 1** prints the full plan and the full `qemu` command line, creates no files, and
  exits 0. `git status` is unchanged afterwards.
- **Step 2** is silent. Any output is a finding; these scripts have never been linted.
- **Step 3** prints `Valid schema user-data.yaml`.
- **Step 4** ends with the paths of `vm/out/sairios-<arch>.qcow2` and
  `vm/out/seed-<arch>.iso`, and `qemu-img info` on the disk reports a 20 GiB virtual size
  with a much smaller actual size.
- **Step 5** ends with `SMOKE: PASSED after Ns (verdict DEGRADED).` and exit status 0.
  `DEGRADED` is the correct result for a bare image, and the printed guest report should
  show `[ ok ]` for node, cage, cog, the DRM device, the `seat` group, the data
  directories and lingering, with warnings only about the absent product tree.

If step 5 reports `FAIL`, the operating-system layer is broken and the guest report names
which check failed. If it times out, read `vm/out/serial-<arch>.log`. Triage for every
common failure is in `docs/VM.md`.
