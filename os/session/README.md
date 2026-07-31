# os/session/

The graphical session for SairiOS v0: `cage` running `cog`, pointed at
`http://127.0.0.1:7800`.

## Files

| File                 | Where it lives on the machine                              | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `sairios-session.sh` | `/opt/sairios/os/session/`, as delivered. Not installed.   | Checks the environment, waits for the shell port, execs `cage -- cog <url>`. |
| `sairios.desktop`    | `/usr/share/wayland-sessions/`, installed by provisioning. | Makes SairiOS selectable in a display manager that already exists.           |

The system unit that starts this on tty1 is `os/systemd/sairios-session.service`.

**The launcher is not installed anywhere.** The unit's `ExecStart=` is
`/usr/local/bin/sairios-session`, and in a VM built from `vm/` that path holds a shim
written by cloud-init, not a copy of `sairios-session.sh`. The shim execs
`/opt/sairios/os/session/sairios-session.sh` when that file is executable, and otherwise
prints a banner on the console saying the operating-system layer provisioned but the
product tree is missing. `sairios-provision` deliberately leaves the shim alone rather
than overwriting it from the tree: on a machine with no tree, the shim is the only thing
standing between the user and a black screen. Editing `sairios-session.sh` therefore takes
effect as soon as the file is delivered, with no install step.

## Why cage and cog

`cage` is a kiosk Wayland compositor whose entire job is to run one application
fullscreen and exit when it exits. `cog` is a WebKit kiosk browser with no chrome, no
tabs and no address bar. Both are packaged in Debian 12. Together they are roughly two
hundred lines of configuration away from being a working appliance.

We are not writing a compositor for v0. It is the single largest way to spend months
building something that is not SairiOS. The interesting problem is what a context is and
how a permission is granted, not how to composite a surface. Everything the user sees is
the shell, rendered from validated SairiUI JSON, inside a browser engine that already
handles fonts, input methods, accessibility, HiDPI and clipboard.

The cost of this choice is real and worth naming:

- **One window.** cage runs exactly one client fullscreen. There is no way to place two
  contexts side by side at the OS level. The shell has to draw its own window management
  inside a single surface. For "every window is a context" this is a simulation, not the
  real thing.
- **No native surfaces.** A context cannot host a non-web application. Anything outside
  the browser engine is out of reach.
- **cog's process model is WebKit's.** Multiple contexts are tabs' worth of isolation at
  best, not OS-level isolation. The permission broker is what actually contains agent
  actions; the browser is not a security boundary in this design.
- **Input is the browser's.** Global shortcuts, drag between contexts, and anything that
  wants to know about the pointer outside the surface do not exist yet.

## Migration path

The session layer was drawn so that replacing it touches nothing else. The contract
between the OS layer and the product is exactly two facts: something serves the shell on
`127.0.0.1:7800`, and something displays it fullscreen. Everything below is a swap of the
second half.

**Stage 1 (v0, here).** `cage` + `cog`. One fullscreen surface, shell-drawn window
management.

**Stage 2. Keep cog, add a real compositor.** Move from `cage` to a scriptable wlroots
compositor (`labwc`, `sway` in a locked-down configuration, or `river`), running one cog
instance per context. Each context becomes a genuine OS window that can be tiled,
stacked and focused. `sairios-session.sh` changes; nothing in `packages/`, `services/` or
`apps/` does. The shell would gain a small privileged channel for "open a surface for
context X", which belongs in the OS layer as a new capability behind the permission
broker, not as a direct compositor connection from the page.

**Stage 3. A SairiOS compositor.** Only if stage 2 proves that we need behaviour no
existing compositor gives us: context-aware window placement, a surface lifecycle tied to
context lifecycle, crystallized contexts that restore their exact window arrangement.
Build it on wlroots or Smithay, not from scratch. The decision point is when compositor
work stops being a means and becomes the thing that differentiates SairiOS. That is not
now, and it may never be.

At every stage, the session layer stays free of product logic. If a compositor needs to
know which contexts exist, it asks the context service over HTTP like anything else.

## Environment contract

`sairios-session.sh` reads these, all optional:

| Variable                      | Default                 | Meaning                                          |
| ----------------------------- | ----------------------- | ------------------------------------------------ |
| `SAIRIOS_SHELL_URL`           | `http://127.0.0.1:7800` | What cog opens.                                  |
| `SAIRIOS_SHELL_HOST`          | `127.0.0.1`             | Host to poll before starting cog.                |
| `SAIRIOS_SHELL_PORT`          | `7800`                  | Port to poll before starting cog.                |
| `SAIRIOS_SHELL_WAIT_SECONDS`  | `120`                   | Bounded wait. On expiry the script fails loudly. |
| `SAIRIOS_SHELL_POLL_INTERVAL` | `1`                     | Seconds between polls.                           |
| `SAIRIOS_SESSION_TTY`         | `/dev/tty1`             | Where failure banners are printed.               |
| `CAGE_BIN` / `COG_BIN`        | `cage` / `cog`          | Override for testing.                            |
| `COG_PLATFORM_NAME`           | `wl`                    | cog's platform plugin.                           |

Set them in `/etc/sairios/session.env`, which the system unit reads with a leading `-`
(optional).

## Failure behaviour

The script is written on the premise that a black screen is the worst possible outcome.
It prints an actionable banner to `/dev/tty1` and to the journal when:

- `XDG_RUNTIME_DIR` is missing, meaning logind never opened a session
- `cage` or `cog` is not installed, with the exact `apt-get` line
- `/dev/dri/card0` does not exist, meaning the guest has no GPU device
- the shell port never opens within the timeout, with the service state and the exact
  `systemctl --user` and `journalctl` commands to run next

Ctrl-Alt-F2 gets you to another VT in every one of those cases.

## Verification status

Never executed. The authoring host was macOS on arm64, with no Wayland, no `cage`, no
`cog` and no systemd. `sairios-session.sh` has passed `bash -n` (parse only) and nothing
further. It has not been run under `shellcheck`, which is not installed on the authoring
host. `sairios.desktop` has not been checked with `desktop-file-validate`.

To verify on a Linux host:

    shellcheck os/session/sairios-session.sh
    desktop-file-validate os/session/sairios.desktop
    SAIRIOS_SHELL_WAIT_SECONDS=5 CAGE_BIN=/bin/true COG_BIN=/bin/true \
        os/session/sairios-session.sh

The third command exercises the wait-and-fail path without needing a compositor: with no
shell listening it should print the banner and exit 1 after about five seconds.
