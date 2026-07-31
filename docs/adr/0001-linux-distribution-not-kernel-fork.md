# 0001. Build on a Linux distribution, not a kernel fork

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

SairiOS is described as an operating system, and that word invites a specific
misunderstanding: that the project needs to write kernel code. It does not.

An operating system delivers a large bundle of capabilities. Boot and firmware handover.
Hardware discovery and drivers. Process creation, scheduling and isolation. Virtual memory.
Filesystems and block devices. The network stack. Users, groups and permission bits.
Service supervision and startup ordering. A graphical session with a display server, input
handling, fonts and a compositor. Package management and security updates.

Every one of those is solved. They are solved by thousands of people over three decades,
with hardware coverage and a security response process that a small team cannot reproduce
and should not try to.

The part that is not solved is the part SairiOS exists for: an environment where the unit
of work is a human intention rather than an application window, where a context carries its
own memory, files, tools, agents and permissions, and where the interface is assembled for
the task at hand rather than launched from an icon grid. None of that lives below the
system call boundary. A context is not a scheduling entity. An adaptive interface is not a
driver. The permission broker described in ADR 0006 is a userspace policy service, not an
LSM.

There is a second force. v0 has to be installable and runnable by contributors and by
early users on ordinary hardware, and it has to receive security updates without the
project maintaining that pipeline. That argues for standing on a distribution with a
stable release, a long support window and a wide package archive.

The starting artifact also matters. The project builds a bootable image, so the base needs
a published, minimal, regularly rebuilt cloud image rather than an interactive installer to
automate around.

## Decision

SairiOS v0 is built on the Debian 12 (bookworm) stable `genericcloud` image. The image is
customized: SairiOS services, the graphical session, the shell application and the
configuration that makes a boot land in a SairiOS session rather than a generic desktop.

SairiOS does not fork the Linux kernel, does not patch the kernel, and does not build an
operating system from scratch. It runs a stock Debian kernel from the stable archive and
takes kernel security updates from Debian.

Linux supplies boot, hardware support, processes, networking, filesystems, drivers, users
and permissions, service supervision and the graphical session. SairiOS supplies contexts,
the adaptive interface protocol, the permission broker, the agent bridge and the shell.
The line between the two is deliberate and is expected to hold for the foreseeable life of
the project.

The phrase used internally is accurate and worth repeating in public: v0 is a custom
Linux-based operating **environment**, not a new operating system kernel.

## Consequences

### Positive

- Hardware support, security updates and the entire base userland come from Debian at no
  engineering cost to the project.
- Engineering attention goes to the product surface. Nobody on the team is debugging
  suspend/resume on a laptop chipset.
- Contributors already know the base. `apt`, systemd, `/etc`, standard filesystem layout.
  Onboarding does not require learning a bespoke system.
- The `genericcloud` image is small, boots headless, and is designed to be automated
  against. That fits the QEMU-based test loop in ADR 0002.
- Debian stable's release cadence is slow, which is a feature for a project that wants its
  base to stop moving while the product moves.

### Negative

- The project inherits Debian's conservatism. Package versions in stable are old by
  design, and anything current (a recent Node, recent Mesa, a recent browser engine) has
  to come from backports, a vendored tarball or a separate channel. This is a recurring
  tax, not a one-time cost.
- Boot time, image size and memory floor are those of a general-purpose distribution.
  There is a lot of software in the image that SairiOS does not use.
- The project does not control the kernel, so any capability that genuinely requires
  kernel changes is out of reach without changing this decision.
- "Operating system" in the marketing sense and "operating environment" in the technical
  sense will be conflated by readers. The project has to keep correcting it.

### Neutral

- The image build is a customization pipeline over an upstream artifact, so the build
  scripts are pinned to a specific upstream image checksum and have to be updated on each
  Debian point release.
- Nothing about this decision prevents shipping additional bases later. A second image
  target is a build-system change, not an architecture change.
- Debian's non-free firmware handling affects which hardware works out of the box and has
  to be decided explicitly in the image build, separately from this ADR.

## Alternatives considered

**Fork the Linux kernel.** Carry patches, or maintain a SairiOS kernel tree, to enforce
context boundaries or context-aware scheduling in-kernel.
Rejected because: the cost is measured in years and in a permanent rebase burden against
upstream, and it buys the product nothing a user can perceive in v0. Contexts do not need
kernel enforcement to be useful; they need a coherent userspace model first. A kernel fork
is what a project does after it has proven the model, not before.

**Ubuntu 24.04 LTS.** A close second, and this should be said plainly rather than
dressed up: for v0 the two are nearly equivalent. Same kernel lineage, same package
tooling, same systemd, same desktop stack, and the SairiOS layer would be almost
byte-identical on either.
Rejected because: Debian's `genericcloud` image is smaller and its default set is lighter,
which suits an image that gets heavily customized and repeatedly rebuilt in a test loop.
What would tip it the other way is concrete and worth watching: broader desktop and
proprietary-driver package availability, and a five-year LTS support window against
Debian's shorter stable-plus-LTS arrangement. If the desktop session starts fighting the
Debian archive, or if the support window becomes a customer question, Ubuntu is the answer
and the switch is a build-script change rather than a redesign.

**NixOS.** Declarative system configuration and genuinely reproducible builds.
Rejected because: for v0 the contributor on-ramp is too steep. Every contributor who wants
to change how the image is assembled has to learn Nix first, and the project cannot afford
that filter while the product model is still moving. The reproducibility argument is real
and gets stronger over time, which is why it appears in "Revisit when" rather than being
dismissed.

**Alpine Linux with musl.** Very small, very clean.
Rejected because: Node and the desktop stack both fight musl. Prebuilt Node binaries,
native modules, glibc-assuming graphics and font libraries and a long tail of desktop
packages all become project problems. The image would be smaller and the debugging would
be constant.

**Buildroot or Yocto.** Assemble a minimal image from source with full control.
Rejected because: neither has a desktop session story that v0 can use. They are the right
tools for an appliance with a fixed, small software set, and SairiOS v0 needs a graphical
session, a browser engine and a general-purpose userland. Choosing them now would mean
building a distribution as a side project.

## Revisit when

- Image size or boot time becomes a stated product requirement that Debian's default set
  cannot meet, for example a target under 1 GB or a boot-to-session under five seconds.
- Reproducible, bit-identical image builds become a compliance or supply-chain requirement
  from a customer or a partner. That is the trigger to re-evaluate NixOS seriously.
- A kernel-level capability becomes the actual differentiator: per-context namespace,
  cgroup or LSM enforcement that userspace cannot approximate, or context-aware scheduling
  that measurably changes what the product can do.
- The Debian archive blocks a desktop requirement that Ubuntu satisfies out of the box, or
  a customer requires a five-year supported base.
- Debian 12 approaches end of security support and the base has to move regardless. That
  is the natural moment to re-run this comparison rather than default to the next Debian.
