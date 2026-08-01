# The SairiOS VM smoke test

How to build a SairiOS image, boot it, tell whether the boot worked, and find out why
when it did not.

QEMU is the canonical full-system test runtime (ADR 0002). Service work does not need it;
`make dev` is the fast loop. Reach for the VM when the question is about the system as a
system: boot, init ordering, service startup under systemd, the graphical session, and
first-run filesystem state.

> **None of the procedures below have been executed.** The machine this was written on
> has no QEMU. Every observation described as "what you should see" is derived from how
> the components are documented to behave, not from having watched them. Treat the first
> real run as the thing that establishes whether this document is correct, and fix it
> where it is wrong. `vm/README.md` lists precisely what was and was not verified.

## What to run

From the repository root.

```sh
# 1. Build the image. ~330 MiB on the first run, cached afterwards.
#    --ssh-key is optional but strongly recommended: without it the guest has no
#    login access at all and the serial console is your only channel.
./vm/qemu/build-image.sh --yes --ssh-key ~/.ssh/id_ed25519.pub

# 2. The automated check. This is what CI runs.
./vm/qemu/run-vm-headless.sh --smoke

# 3. Watch it boot yourself, on a serial console.
./vm/qemu/run-vm-headless.sh

# 4. Watch it boot with a display, which is the only way to see the session.
./vm/qemu/run-vm.sh
```

The smoke check's exit status is the signal:

| Exit | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Guest reported `OK`, or `DEGRADED` without `--strict`. |
| 1    | Guest reported `FAIL`, or `DEGRADED` with `--strict`.  |
| 2    | Timeout expired with no verdict on the serial console. |
| 3    | QEMU exited before the guest reported anything.        |

`DEGRADED` is a pass for a freshly built image. The image ships the operating-system
layer with an empty `/opt/sairios`; SairiOS is delivered separately. Use `--strict` only
after delivering the product tree.

Node is installed from the official nodejs.org tarball, verified against a pinned SHA-256, so there is no third-party apt key to fill in and nothing blocks the Node step.

Under TCG (any cross-architecture run) raise the bound: `--smoke --timeout 2400`. The
default 600s will time out, and the script warns before it starts.

## What to observe, stage by stage

Serial output goes to your terminal in interactive mode, and to
`vm/out/serial-<arch>.log` in `--smoke` mode. Follow it live with
`tail -f vm/out/serial-<arch>.log`.

Six stages. Knowing which one you got stuck in eliminates most of the search space.

**1. Firmware.** On arm64, edk2 prints a `UEFI firmware` banner. On amd64, SeaBIOS
prints a version line. Nothing at all here means QEMU itself failed to start; look at
`vm/out/qemu-<arch>.log`.

**2. Bootloader.** GRUB loads the kernel and initrd. Brief, and easy to miss.

**3. Kernel.** Normal Linux boot messages. The important line to look for is the guest
finding both disks: the qcow2 as `vda` and the seed ISO as `vdb`. No `vdb` means
cloud-init has nothing to read, and stage 4 will silently do nothing.

**4. cloud-init.** Four stages announce themselves: `init-local`, `init`,
`modules:config`, `modules:final`. This is where the time goes on a first boot: `apt-get
update`, the package installs, and the pinned Node tarball download and checksum.
Several minutes accelerated, considerably longer under TCG. On a subsequent boot of the
same disk, cloud-init recognises the instance and skips all of it.

**5. Provisioning.** `sairios-provision` prints one line per unit it installs, or says
`no product tree at /opt/sairios/os - nothing to install`, which is correct and expected
for a bare image.

**6. The report.** The first-boot self-check writes its report to the console and to
`/var/log/sairios-firstboot.log`, ending in a verdict line. cloud-init's `final_message`
follows. If you get here, the boot worked; the report tells you how well.

On a graphical run there is a seventh thing to watch, on the QEMU window rather than the
serial console: the screen stays blank until the guest binds the virtio-gpu DRM driver,
then `cage` starts and `cog` opens the shell. A blank window for the first several
seconds is normal. A blank window after the report has printed is not, and
`os/session/README.md` covers that path.

## Reading `/var/log/sairios-firstboot.log`

Written on every boot by `sairios-firstboot-check.service`, repeated on the serial
console, with the previous boot's copy kept as `.log.1`.

```
==================== SAIRIOS FIRST BOOT REPORT ====================
generated : 2026-07-31T18:20:11Z
hostname  : sairios
kernel    : Linux 6.1.0-...
machine   : aarch64

--- base system ---------------------------------------------------
[ ok  ] distribution: Debian GNU/Linux 12 (bookworm)
[ ok  ] node present: v22.23.2
[ ok  ] node major version 22 meets the >= 22 requirement
...
--- summary -------------------------------------------------------
ok: 21   warn: 6   fail: 0

SAIRIOS-FIRSTBOOT: DEGRADED
```

Three markers, and the distinction between the last two is the whole design of the check:

- `[ ok  ]` — present and working.
- `[warn ]` — expected to be absent right now. Almost always "no product tree", which is
  the normal state of a freshly built image.
- `[fail ]` — the operating-system layer is broken. Something in `vm/cloud-init/` or
  `os/` is wrong, and the line names what.

The verdict is derived mechanically: any `fail` gives `FAIL`, otherwise any `warn` gives
`DEGRADED`, otherwise `OK`. A bare image cannot reach `OK`, because the port and service
checks cannot pass without SairiOS running. Do not chase that.

Sections, in order: base system (distribution, Node ≥ 22), graphical session (`cage`,
`cog`, `/dev/dri/card0`, the `seat` group, `sairi`'s group membership, `seatd`), the
SairiOS layout (`/opt/sairios`, the four data directories, the user env file, lingering),
the product tree, the four services, and the four ports.

Read the first `[fail ]` line, not the last. The checks are ordered so that causes appear
before their consequences: a missing `seat` group is reported before the session that
depends on it, and an absent product tree before the services that cannot start without
one.

## Triage

### The report says `node is NOT installed`

The Node step aborted. It installs the official nodejs.org tarball and verifies it against
a SHA-256 pinned in `vm/cloud-init/user-data.yaml`, so the serial log carries one of:

- `sairios: Node step ABORTED: could not download ...` — the guest had no working egress
  when cloud-init ran.
- `sairios: Node step ABORTED: checksum mismatch ...` — the download did not match the pin.
  Do not "fix" this by loosening the check. Either the pin is stale (someone bumped
  `NODE_VERSION` without bumping both hashes) or you did not get the file you asked for.
- `sairios: Node step ABORTED: unsupported architecture ...` — only arm64 and amd64 are
  pinned.

### QEMU exits immediately (smoke exit 3)

Read `vm/out/qemu-<arch>.log`. QEMU's own errors go there and are usually specific:
an unknown machine type, an accelerator it cannot open, a firmware file it cannot load.
This is a host problem, not a guest problem. `./vm/qemu/run-vm.sh --dry-run` prints the
exact command line so you can run it by hand and see the error directly.

### No KVM or HVF: everything is glacial

The script prints its accelerator at startup. If it says `tcg`, there are two possible
reasons and it tells you which.

**Architecture mismatch.** An `amd64` guest on Apple Silicon, or an `arm64` guest on a
Linux x86_64 box. This cannot be fixed with a flag; acceleration requires matching
instruction sets. Build for the host architecture instead:

```sh
./vm/qemu/build-image.sh --arch arm64 --yes    # on Apple Silicon
./vm/qemu/build-image.sh --arch amd64 --yes    # on Linux x86_64
```

**Linux, matching architecture, still TCG.** `/dev/kvm` exists but you cannot open it.
The script checks for read _and_ write access precisely so this surfaces at startup
rather than mid-boot:

```sh
ls -l /dev/kvm                 # expect crw-rw---- root kvm
sudo usermod -aG kvm "$USER"   # then log out and back in; `newgrp kvm` for this shell
```

If `/dev/kvm` is absent entirely, virtualisation is off in firmware, or you are already
inside a VM without nested virtualisation.

On macOS, HVF needs no configuration but does need a QEMU built with it. `brew install
qemu` provides one.

### Missing UEFI firmware (arm64 only)

The aarch64 `virt` machine has no built-in BIOS, so an arm64 guest cannot boot without
edk2. The script searches the usual Homebrew, Debian, Fedora and Arch locations and, if
it finds nothing, prints every path it looked at plus the install command for your
platform:

```sh
brew install qemu                            # macOS, ships edk2-aarch64-code.fd
sudo apt-get install -y qemu-efi-aarch64     # Debian/Ubuntu
sudo dnf install -y edk2-aarch64             # Fedora
sudo pacman -S edk2-armvirt                  # Arch
```

If it is installed somewhere unusual, point at it directly:

```sh
./vm/qemu/run-vm.sh --arch arm64 --firmware /path/to/edk2-aarch64-code.fd
```

Firmware is copied into a 64 MiB pflash image under `vm/out/` before use. The aarch64
`virt` machine requires exactly that size, and distribution builds disagree: Debian's
`AAVMF_CODE.fd` is already padded, while `QEMU_EFI.fd` is a bare 2 MiB build. The scripts
pad automatically, so `device requires 67108864 bytes, image is 2097152 bytes` should not
happen. If it does, `vm/out/firmware-code-<arch>.fd` is stale: delete it and re-run.

Symptom of no firmware at all: the VM starts, the window opens, and nothing ever appears.

### The seed ISO was not read: cloud-init never provisioned

The clearest test, from inside the guest:

```sh
id sairi
```

If that fails, cloud-init never applied `user-data`, and everything else you might notice
(hostname still `debian`, no `cage`, no `/opt/sairios`) is downstream of it.

Work through:

```sh
sudo cloud-init status --long     # expect: status: done
lsblk -f                          # expect a vdb with iso9660 and LABEL "cidata"
ls /var/lib/cloud/seed/nocloud*/  # expect user-data, meta-data, network-config
sudo journalctl -u cloud-init-local -b --no-pager
```

Causes, in the order they actually occur:

**The disk is missing.** No `vdb` in `lsblk`. The seed was not attached. Confirm
`vm/out/seed-<arch>.iso` exists and appears in `run-vm.sh --dry-run` output; rebuild with
`build-image.sh` if not.

**The disk is there but the label is wrong.** `lsblk -f` shows `iso9660` with no
`cidata` label. cloud-init finds the seed by volume label and will not look at an
unlabelled filesystem. Rebuild the seed.

**The label is right but the filenames are wrong.** The subtlest failure, and it looks
exactly like a stock Debian boot. ISO9660 upper-cases filenames; cloud-init needs
lowercase `user-data`. The seed is built with Joliet or Rock Ridge extensions, which
preserve case. Mount it and look:

```sh
sudo mount -o loop,ro vm/out/seed-<arch>.iso /mnt
ls -l /mnt        # must be exactly: user-data  meta-data  network-config
```

`USER-DATA;1` means the extensions were lost and `build_seed_iso` in `build-image.sh`
dropped its `-joliet`/`-rock` flag.

**Everything is correct and it still did not apply.** You are rebooting a disk that was
already provisioned. cloud-init compares the seed's `instance-id` against
`/var/lib/cloud/instance-id`; a match means "reboot" and the per-instance modules are
skipped. **Editing `user-data.yaml` and rebooting the same disk does nothing.** Either
build a fresh disk, bump `instance-id` in `meta-data.yaml`, or:

```sh
sudo cloud-init clean --logs && sudo reboot
```

A fresh disk is the honest test, because it is the path a new user takes. Note that
`--smoke` discards disk writes by default precisely so that every run re-tests first
boot.

### The shell port never opens

The report shows `127.0.0.1:7800 not answering (shell)` as `[fail ]`, or the session
prints its "shell never answered" banner on tty1 after 120 seconds.

If the product tree is absent this is a `[warn ]`, not a failure, and there is nothing to
fix — deliver SairiOS first (`vm/cloud-init/README.md`).

With a tree present, work down the chain as `debian` over SSH:

```sh
# Is the user manager even running? Without lingering it is not, and no user unit
# has started at all. This is the single most common cause.
loginctl show-user sairi -p Linger        # expect Linger=yes
sudo loginctl enable-linger sairi

# Service state and logs, in sairi's own user manager.
sudo runuser -u sairi -- env XDG_RUNTIME_DIR=/run/user/$(id -u sairi) \
  systemctl --user status sairios-shell.service
sudo runuser -u sairi -- env XDG_RUNTIME_DIR=/run/user/$(id -u sairi) \
  journalctl --user -u sairios-shell.service -n 100 --no-pager

# Was the shell ever built, and are its dependencies installed?
ls /opt/sairios/apps/shell/dist
ls -d /opt/sairios/node_modules
```

Common causes:

- **Lingering is off.** No user manager, so none of the four services exist. The check
  reports it explicitly.
- **`node_modules` is missing.** The delivery instructions exclude it on purpose, because
  copying native modules from a macOS arm64 host to a Linux guest ships binaries for the
  wrong platform. Run `sudo npm ci --omit=dev` in `/opt/sairios` inside the guest.
- **`node_modules` was installed with `--omit=dev`.** Same symptom, different cause, and
  it looks like a sensible thing to have done. The shell unit's `ExecStart=` is
  `npm run preview --workspace @sairios/shell`, which is `vite preview`, and `vite` is a
  devDependency of the root `package.json`. With dev dependencies omitted there is no
  `vite` to run, the unit fails at start, nothing listens on 7800, and the session waits
  out its timeout and prints a banner. Re-run `npm ci` without the flag. The alternative
  is to serve `apps/shell/dist` with something that is not a build tool, which is the
  migration noted in the unit file; nothing does that today.
- **The shell was never built.** No `apps/shell/dist`. Run `npm run build`.
- **Ownership.** `/opt/sairios` must be `sairi:sairi`. A tree copied as root leaves the
  services unable to read it.
- **Port collision.** The unit passes `--strictPort`, so a collision fails loudly rather
  than silently moving to 7801 and colliding with the context service. The journal says
  so.

Note that `curl http://127.0.0.1:7800` must be run **inside the guest**. The same command
on the host fails even when everything works, because the services bind guest loopback
and QEMU's port forwarding cannot reach it. Use `ssh -N -L 7800:127.0.0.1:7800 -p 22022
debian@127.0.0.1` instead; `vm/README.md` explains why.

### Black screen with a working report

The report says `OK` but the QEMU window is blank. The services are fine and the session
is not. Check, in this order:

```sh
systemctl status sairios-session.service
journalctl -u sairios-session.service -b --no-pager
ls -l /dev/dri/            # cage needs a DRM device
id -nG sairi               # needs video, render, input, seat
getent group seat          # the unit names it; a missing group blocks startup
```

A missing `seat` group prevents the unit from starting at all, which is why cloud-init
creates it unconditionally. `os/session/README.md` documents the launcher's own failure
banners, which are printed on tty1 for exactly this situation.

### The smoke check times out (exit 2)

Read the tail of `vm/out/serial-<arch>.log`, which the script prints.

- **Log ends mid-boot.** The guest is alive and slow. Re-run with a larger `--timeout`.
  Under TCG, 2400 is reasonable.
- **Log is empty.** The guest never reached a serial console. Go back to the firmware and
  bootloader stages above.
- **Log ends after cloud-init started.** Provisioning is stuck, most often on `apt`
  waiting for a network that is not there. Boot interactively and look.

## Resetting

```sh
./vm/qemu/clean.sh          # remove vm/out/; keeps the downloaded base images
./vm/qemu/clean.sh --all    # also remove vm/.cache/, forcing a re-download
```

Rebuilding the working disk is the fastest way back to a known state, and it is the only
way to re-test first-boot provisioning. `clean.sh` keeps `vm/.cache/` by default because
re-downloading ~330 MiB to fix a broken `vm/out/` is a waste.
