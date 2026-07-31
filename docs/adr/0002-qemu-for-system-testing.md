# 0002. QEMU for full-system testing, Docker for services

- Status: Accepted
- Date: 2026-07-31
- Deciders: SairiOS founding engineering

## Context

ADR 0001 makes SairiOS a customized Debian image. That creates a testing problem that
service-level tests cannot answer.

The questions that only a full system can answer are: does the image boot, does the
bootloader hand off correctly, do the SairiOS services start in the right order under the
init system, does the graphical session come up, does the shell reach the services on
loopback, do the data directory and sandbox get created with the right ownership, and does
a fresh boot on a fresh disk produce a usable environment. Those are integration
properties of an operating environment, and they fail in ways unit tests never see.

At the same time, most day-to-day development is service work. Editing the context service,
the agent bridge, the permission broker or the shell should not require booting anything.
That loop needs to be fast and it needs to run on the developer's own machine.

There is also a sandboxing need that is separate from both: agent-proposed tool execution
should be able to run in a disposable container with a constrained filesystem and network,
independent of whether the developer is running an image at the time.

Host reality constrains all of this. Contributors are on Linux x86_64, on Apple Silicon
macOS, and occasionally on Windows. The acceleration story differs per host, and the
cross-architecture story differs a lot. This matters enough to state precisely rather than
leave people to discover it.

Finally, an honest note about this specific repository: the host this project was
scaffolded on is macOS arm64 with neither Docker nor QEMU installed. Everything in this
ADR describing runtime behavior is design intent. It has not been executed here, and any
script in the repository that depends on QEMU or Docker is unverified on this machine until
someone runs it on a host that has them.

## Decision

QEMU is the canonical full-system test runtime for SairiOS. The `vm-image`, `vm-run`,
`vm-run-headless` and `vm-clean` targets build and drive a QEMU virtual machine, and a
change is not considered validated at the system level until it has been exercised there.

Docker is used for two things and no others: reproducible service-level development
environments, and sandboxing tool execution. Docker is not a SairiOS runtime target. There
is no supported "SairiOS in a container" configuration.

### Host acceleration

The VM scripts select acceleration by host and report which one they used, because the
performance difference is large enough that a user needs to know.

- **Linux**: KVM (`-accel kvm`) when `/dev/kvm` is present and the user can open it.
  This is the fast path and the reference configuration.
- **macOS**: Hypervisor.framework (`-accel hvf`). Available for a guest whose architecture
  matches the host, which in practice means an aarch64 guest on Apple Silicon.
- **Anywhere**: TCG (`-accel tcg`), QEMU's software emulation. Always available, always
  correct, and roughly an order of magnitude slower. It is the fallback, not a target.

### Cross-architecture honesty

Hardware acceleration requires the guest architecture to match the host. There is no way
around this, and pretending otherwise wastes contributors' time:

- An **x86_64 guest on Apple Silicon** runs under TCG. It works. It is slow enough that a
  boot takes minutes rather than seconds, and it is not a reasonable inner loop.
- On Apple Silicon, prefer an **aarch64 guest** with HVF, which is fast.
- On Linux x86_64, prefer an **x86_64 guest** with KVM.
- Therefore SairiOS builds and tests **both** an x86_64 and an aarch64 image. This is not
  optional convenience. It is what lets contributors on either host have a usable loop.

The scripts default to the guest architecture matching the host, and require an explicit
flag to build or run a mismatched pair, with a printed warning that it will run under TCG.

## Consequences

### Positive

- Boot, init ordering, service startup, session bring-up and first-run filesystem state
  are all actually tested, on the same artifact users receive.
- Failures reproduce. A VM disk can be snapshotted, reset and re-run, so a first-boot bug
  is not a one-shot observation.
- QEMU runs on all three host families and in CI without special hardware, because TCG is
  always available even where KVM is not.
- The service loop stays fast, because it does not go through the VM at all.
- Tool sandboxing gets a container boundary that is independent of the image, so it can be
  developed and tested without a VM.

### Negative

- Two virtualization technologies in the project means two sets of scripts, two failure
  modes and two things a contributor may need installed.
- Building and testing two guest architectures roughly doubles image build time and CI
  minutes.
- QEMU command lines are long, version-sensitive and full of host-specific detail. The
  wrapper scripts will accumulate special cases, and they are a maintenance item.
- Graphics inside QEMU are not the graphics a user gets on real hardware. Testing the
  graphical session in a VM validates that it comes up, not that it performs.
- On a host without KVM or HVF, the full-system loop is slow enough that people will avoid
  running it. That has to be countered with CI, not with optimism.

### Neutral

- CI runs the headless target (`vm-run-headless`) with serial console output as the machine
  readable signal. The interactive target exists for humans.
- The choice of QEMU does not constrain the eventual installer or the bare-metal story.
  Both are separate decisions.
- Neither QEMU nor Docker is installed on the machine where this repository was scaffolded,
  so none of the above has been executed here.

## Alternatives considered

**Docker as the OS runtime.** Ship and test SairiOS as a container image.
Rejected because: a container is not a system. There is no init to order services under,
no session, no display server, no bootloader, and no first-boot path. Half of what a
full-system test exists to catch is definitionally absent. It is also the wrong trust
model: the permission broker in ADR 0006 assumes a boundary between the user's environment
and agent-proposed actions, and collapsing everything into one container namespace with a
shared kernel makes that boundary weaker and harder to reason about.

**VirtualBox.** Familiar, has a GUI, widely installed.
Rejected because: the Apple Silicon story is weak, and a meaningful share of contributors
are on Apple Silicon. Choosing it would mean those contributors have no local full-system
loop at all. Its automation surface is also less scriptable than QEMU's for the headless
CI case.

**Cloud CI VMs only.** Skip local virtualization; test the image in a cloud runner.
Rejected because: it removes the local loop entirely. Debugging a boot failure through CI
logs, with a five-to-fifteen minute round trip per attempt, is not a workable way to
develop an operating environment. Cloud CI is a complement and will be used, but it cannot
be the only place the image runs.

**UTM, Lima or Vagrant as the canonical runner.** Higher-level wrappers, nicer to use.
Rejected because: as the canonical runner, each is a layer over QEMU with its own
configuration format, its own bugs and its own release cadence. When a boot fails, the
question becomes whether it is SairiOS, QEMU or the wrapper, and that is one question too
many. They are
fine as convenience on a contributor's own machine, and a contributor who prefers UTM is
welcome to it. The canonical path is plain QEMU with explicit flags, so that what CI runs
and what a maintainer runs are the same thing.

## Revisit when

- QEMU's macOS or Apple Silicon support regresses badly enough that HVF becomes unreliable,
  or a better-supported alternative appears with equivalent scriptability.
- The full-system suite gets slow enough that contributors routinely skip it, at which
  point the answer is probably a tiered suite (a fast smoke boot locally, the full matrix
  in CI) rather than a different tool.
- Bare-metal or real-hardware testing becomes a release requirement, which adds a third
  runtime and forces a re-look at what QEMU is still responsible for.
- A microVM runtime (Firecracker, Cloud Hypervisor) can boot the SairiOS image with a
  graphical session and does so materially faster. Today they cannot.
- The graphical session's performance characteristics, not just its correctness, become a
  thing the test suite must assert. QEMU cannot answer that and hardware will be needed.
