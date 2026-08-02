# os/

Privileged operating-system integration for SairiOS.

Everything in this directory is _host_ material: systemd units, the graphical session,
and branding assets that are installed into a Linux system. None of it is product code.

## The layer boundary

`os/` may contain:

- systemd unit files and their documentation
- session launchers and desktop entries
- branding assets consumed by the OS layer (login/session chrome, wallpaper, mark)
- anything that must be installed with root privileges into a system path

`os/` must **not** contain:

- TypeScript or JavaScript that is part of the product
- anything that imports from `packages/`, `services/` or `apps/`
- context, permission, agent or SairiUI logic of any kind

The relationship runs one way. `os/` refers to the product only by **path and port**:
it knows that a build lands in `/opt/sairios`, that the shell answers on `127.0.0.1:7800`,
and that the three services answer on `7801`, `7802` and `7803`. It knows nothing else.
If a change to `os/` would require knowing what a context _is_, it belongs somewhere else.

The product likewise never reads from `os/`. A service that needed to parse a unit file
would be a layering violation.

## Contents

| Path                                        | What it is                             | Installed to                              |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `systemd/sairios-context-service.service`   | user unit, context store               | `~/.config/systemd/user/`                 |
| `systemd/sairios-agent-bridge.service`      | user unit, agent transport             | `~/.config/systemd/user/`                 |
| `systemd/sairios-permission-broker.service` | user unit, capability broker           | `~/.config/systemd/user/`                 |
| `systemd/sairios-shell.service`             | user unit, shell HTTP server           | `~/.config/systemd/user/`                 |
| `systemd/sairios-session.service`           | **system** unit, kiosk session on a VT | `/etc/systemd/system/`                    |
| `session/sairios-session.sh`                | session launcher (`cage` + `cog`)      | not installed; run in place from the tree |
| `session/sairios.desktop`                   | Wayland session entry                  | `/usr/share/wayland-sessions/`            |
| `branding/palette.css`                      | design tokens (generated)              | `/usr/share/sairios/`                     |
| `branding/sairios-logo.svg`                 | the logo                               | `/usr/share/sairios/`, session icon       |
| `branding/sairios-mark.svg`                 | monochrome mark                        | `/usr/share/sairios/`; for `currentColor` |
| `branding/sairios-wallpaper.svg`            | 16:9 wallpaper                         | session background                        |

In a VM built from `vm/`, these are installed system-wide by
`/usr/local/sbin/sairios-provision` (written by cloud-init): the four user units go to
`/etc/systemd/user/`, which is the system-wide equivalent of `~/.config/systemd/user/`
and has identical semantics. The unit text is the same either way.

The session launcher is the exception, and `sairios-provision` says so in a comment.
`sairios-session.service` starts `/usr/local/bin/sairios-session`, which cloud-init writes
as a shim: it execs `/opt/sairios/os/session/sairios-session.sh` if that file is
executable, and prints a legible banner on the console if it is not. Provisioning does not
overwrite the shim with the tree's launcher, because on a machine whose product tree is
missing the shim is the only thing that explains the missing tree instead of showing a
black screen.

`branding/palette.css` is **generated** from `packages/ui-components/src/tokens.css`,
which is the one canonical set of design tokens. It exists so OS-level chrome can use the
shell's exact values without importing from a workspace package, and it adds the
`prefers-color-scheme` query the shell does not need (the shell resolves the theme in
JavaScript; a greeter cannot).

Regenerate with `npm run build:palette`; `os/branding/palette.test.ts` fails if it has
drifted. Previously the two files were maintained by hand, shared eighteen token names and
disagreed on every one of them.

## Design decisions worth stating once

**Four user units, one system unit.** The services run as the unprivileged user `sairi`
under that user's own systemd instance. Only the graphical session needs a system unit,
because only it needs to claim a VT and open a seat. Nothing in SairiOS runs as root
after boot.

**Ordering is `context-service` then `permission-broker` then `agent-bridge` then
`shell`.** Ordering is expressed with `After=`. Hard dependency is expressed with
`Requires=` and is used sparingly: only the agent bridge genuinely cannot function
without the context service. The shell deliberately uses `Wants=`, because a shell that
starts and renders a legible "services unavailable" state is more useful during triage
than a shell that refuses to start.

**No network for two of the four.** The context service and the shell have
`IPAddressAllow=localhost` with `IPAddressDeny=any`. The agent bridge is exempt because
it must reach the OpenClaw gateway, which `OPENCLAW_GATEWAY_URL` may point off-box. The
permission broker is exempt because executing the `network.fetch` capability is its job,
and that execution is gated by policy rather than by the unit file.

**`MemoryDenyWriteExecute` is omitted everywhere.** V8 allocates writable-then-executable
pages for JIT compilation. Setting it would prevent Node from starting. Every unit says
so in a comment so that nobody "fixes" the omission.

**`ProtectProc=invisible` is set on three of the four.** The permission broker is the
exception, because the `process.list` capability requires it to see other processes in
`/proc`.

## Verification status

Read this section before trusting anything above.

The authoring host was macOS on arm64 with no Docker, no QEMU and no systemd. Nothing in
this directory has been executed, parsed by systemd, or booted.

| Item                                                 | Status                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unit files parsed by `systemd-analyze verify`        | **Not run.** No systemd on the authoring host.                                                      |
| Units started, stopped or restarted                  | **Not run.**                                                                                        |
| Sandboxing directives confirmed effective            | **Not run.** See the caveat below.                                                                  |
| `session/sairios-session.sh` executed                | **Not run.** No `cage`, no `cog`, no Wayland.                                                       |
| `session/sairios-session.sh` checked by `shellcheck` | **Not run.** `shellcheck` is not installed on the authoring host. Written to be clean; unconfirmed. |
| Desktop entry validated by `desktop-file-validate`   | **Not run.**                                                                                        |
| SVG assets rendered                                  | **Not run.** Written by hand; geometry is arithmetic, not observation.                              |
| `palette.css` contrast ratios measured               | **Not run.** Values were chosen to clear WCAG AA by construction and have not been measured.        |

To verify the units yourself, on a Linux host with systemd:

    systemd-analyze verify os/systemd/sairios-context-service.service
    systemd-analyze verify os/systemd/sairios-agent-bridge.service
    systemd-analyze verify os/systemd/sairios-permission-broker.service
    systemd-analyze verify os/systemd/sairios-shell.service
    systemd-analyze verify os/systemd/sairios-session.service

Correct output is no output at all, and exit status 0. `systemd-analyze verify` will warn
about missing `ExecStart=` binaries when run outside the target image; those warnings are
expected unless `/opt/sairios` is populated.

After installing the user units, review the effective sandbox with:

    systemd-analyze --user security sairios-context-service.service

### Caveat: sandboxing in user units

Several directives used here behave differently, or not at all, in a _user_ unit:

- `IPAddressAllow=` / `IPAddressDeny=` are implemented with cgroup BPF and require the
  user manager's cgroup to have delegation. If they are ineffective, systemd does not
  error; it silently does nothing. **They are defence in depth only.** The authoritative
  control is that every service binds `127.0.0.1` (`SAIRIOS_BIND_HOST`).
- `ProtectSystem=`, `ProtectHome=`, `PrivateTmp=` and friends need unprivileged user
  namespaces. Debian 12 enables them by default. If a unit fails to start with
  `Failed to set up mount namespacing`, check `sysctl kernel.unprivileged_userns_clone`
  and `sysctl kernel.apparmor_restrict_unprivileged_userns`.
- Capability-related directives are near-no-ops: a user unit already runs with no
  capabilities.

Do not treat a green `systemd-analyze security` score as evidence that the restrictions
are enforced. Test them.

## Kernel policy

SairiOS v0 does not build, patch, configure or otherwise touch a kernel. The guest runs
the stock Debian 12 kernel from the Debian cloud image, unmodified. There is no
out-of-tree module, no custom `.config`, no initramfs surgery and no boot-parameter
tuning beyond what the cloud image ships. "SairiOS is an operating environment, not a
kernel" is a design constraint, not a stage we intend to pass through.
