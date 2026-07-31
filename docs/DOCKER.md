# Docker in SairiOS

    Docker = service development and tool sandboxing
    QEMU   = full SairiOS integration testing

Docker is not how SairiOS runs. No image in this repository boots SairiOS as an
operating environment, and none is meant to. Docker has exactly two jobs here:

1. Running the three background services in isolation so they can be developed
   and exercised without depending on the state of your host toolchain.
2. Sandboxing agent tool execution, so that an execution the permission broker
   approved runs somewhere with a small blast radius.

Everything in `containers/` serves one of those two jobs. If a change to that
directory does not, it belongs somewhere else.

## Which one do I reach for

| You want to                                                          | Use                     | Why                                                                                             |
| -------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| Edit a service and see the change immediately                        | `make dev`              | Hot reload, host debugger, fastest loop. Docker adds a rebuild between you and the result.      |
| Reproduce a bug that only appears on Linux                           | Docker                  | Same service, Linux kernel, glibc, real filesystem semantics.                                   |
| Work on a service while your host Node is the wrong version          | Docker                  | The image pins Node 22 regardless of what is on your machine.                                   |
| Check that the services still start from a clean tree                | Docker                  | `npm ci` from the lockfile with no host `node_modules` anywhere.                                |
| Run an agent tool execution you do not fully trust                   | Docker (`tool-sandbox`) | No network, no package manager, one writable path.                                              |
| See SairiOS as an operating environment                              | QEMU                    | The shell, the compositor and the session are the point, and none of them exist in a container. |
| Test boot, session startup, or anything about the system as a system | QEMU                    | Containers share the host kernel and have no init, no display and no login.                     |
| Demonstrate SairiOS to someone                                       | QEMU                    | It is the only artifact that looks like the product.                                            |
| Ship a release image of the OS                                       | QEMU                    | Docker images here are development tooling and are never a release artifact.                    |

Rules of thumb, in order:

- Default to `make dev`. It is the fastest loop and it is what most work needs.
- Reach for Docker when the question is about Linux, about isolation, or about
  a clean dependency tree.
- Reach for QEMU when the question is about the system rather than about a
  service.

There are no `make` targets for Docker. The Makefile covers `setup dev test
lint typecheck build vm-image vm-run vm-run-headless vm-clean doctor clean`,
and Docker is driven directly with `docker compose` so that the boundary stays
visible. If Docker had a `make` target next to `dev`, it would start to look
like an alternative way to run SairiOS, which it is not.

## Commands

All commands run from the repository root. `--project-directory .` makes the
repository-root `.env` the interpolation source for `containers/compose.yaml`.
Every default in that file is safe without a `.env`.

```sh
# One-time: make the canonical exclude list take effect (see the note below).
for f in containers/*.Dockerfile; do cp containers/.dockerignore "$f.dockerignore"; done

# Build all four images.
docker compose --project-directory . -f containers/compose.yaml build

# Build one.
docker compose --project-directory . -f containers/compose.yaml build agent-bridge

# Start the three services in the foreground.
docker compose --project-directory . -f containers/compose.yaml up \
  context-service permission-broker agent-bridge

# Start them detached and watch one log stream.
docker compose --project-directory . -f containers/compose.yaml up -d \
  context-service permission-broker agent-bridge
docker compose --project-directory . -f containers/compose.yaml logs -f agent-bridge

# Health, from the host. Loopback only.
curl -s http://127.0.0.1:7801/healthz   # context-service
curl -s http://127.0.0.1:7802/healthz   # agent-bridge
curl -s http://127.0.0.1:7803/healthz   # permission-broker

# Container-reported health.
docker compose --project-directory . -f containers/compose.yaml ps

# Sandbox: start it and get a shell in it.
docker compose --project-directory . -f containers/compose.yaml up -d tool-sandbox
docker compose --project-directory . -f containers/compose.yaml exec tool-sandbox sh

# Stop everything, keep the data.
docker compose --project-directory . -f containers/compose.yaml down

# Stop everything and delete the named volumes, including the sandbox
# workspace and the context store.
docker compose --project-directory . -f containers/compose.yaml down -v
```

Running the shell against containerised services: start the services as above,
then run the Vite dev server on the host with `npm run dev --workspace
@sairios/shell`. The shell is not containerised. It is a browser application
served by Vite on port 7800, and putting it in a container buys nothing and
costs hot reload.

### Build context and `.dockerignore`

The build context is the repository root, because npm workspaces need the root
`package.json`, the lockfile, and every workspace manifest for `npm ci` to run
at all. Docker reads `<context>/.dockerignore`, which is therefore the
repository root and not `containers/.dockerignore`.

`containers/.dockerignore` is the canonical list. BuildKit also honours a
per-Dockerfile ignore file named `<dockerfile>.dockerignore`, which is what the
one-time copy command above sets up. Skipping it does not break the build; it
makes the context much larger and the builds slower.

## Threat model for tool sandboxing

The sandbox exists because of three assumptions. Design against all three at
once, not one at a time.

### Assumption 1: model output is untrusted input

Anything a model produces is data that arrived from outside the trust boundary.
It is not a decision, not an authorisation, and not a command. A tool call
proposing `files.delete` on a path outside the sandbox is not a bug in the
model to be patched later; it is the expected shape of untrusted input, and the
permission broker is the thing that must say no.

Consequences already built into the design:

- The model never returns executable frontend code. SairiUI is a declarative
  JSON protocol, validated against a JSON Schema and a 16-component audited
  catalog before anything renders. An unknown component type or an unknown prop
  rejects the entire document and a safe error state renders instead. There is
  no partial acceptance, because partial acceptance is how a malformed document
  becomes a rendered one.
- There is no unrestricted shell execution path from the model. `process.execute`
  defaults to `deny`. The sandbox image contains no package manager and no HTTP
  client, so even a successful escape into it lands somewhere with very little
  to reach for.
- Agent file actions are confined to `SAIRIOS_SANDBOX_DIR`. In containers that
  is `/workspace`, a named volume, not the repository and not your home
  directory.

### Assumption 2: retrieved web content carries prompt injection

Any content fetched through `network.fetch` should be treated as an active
attempt to redirect the agent. Page text, HTML comments, alt attributes, PDF
metadata and text rendered invisibly all reach the model the same way.

Consequences:

- `network.fetch` defaults to `ask`. The user sees the target before the fetch
  happens.
- The fetch is performed by the permission broker, not by the sandbox. That is
  why `tool-sandbox` runs with `network_mode: none` and ships no `curl` or
  `wget`. Giving the sandbox its own route to the internet would create a fetch
  path that no policy ever sees and no audit log ever records.
- A grant is scoped. "Allow for this context" means this context, and injected
  content that persuades the agent to fetch something else in another context
  still meets a prompt.
- Retrieved content that proposes an action is a proposal, and proposals go
  through the same broker as every other proposal. Content is never
  authorisation. The separation of observation, proposal and execution exists
  precisely so that a convincing paragraph cannot become an execution.

### Assumption 3: context files may be malicious

A context carries files, and those files arrive from downloads, from other
people, and from the agent itself. Treat the sandbox workspace as attacker
controlled at all times.

Consequences:

- `/workspace` is the only writable path in the sandbox container. The root
  filesystem is read-only, and `/tmp` is a `noexec` tmpfs, so a file written
  into it cannot be executed from it.
- No build toolchain is installed, so a written file cannot be compiled into a
  binary.
- The container runs as uid 10001 with every Linux capability dropped and
  `no-new-privileges` set, so a setuid binary written into the workspace cannot
  regain privileges.
- `pids_limit` and the memory and CPU limits bound the damage from something
  designed to exhaust resources rather than to steal data.
- `files.delete` defaults to `deny` and there is no "allow for this context"
  path that a user reaches by accident.

### What the sandbox is actually defending

In order of how much confidence to place in each:

1. Accidents. A tool that writes to the wrong path, a loop that never
   terminates, a dependency that fills a disk. This is where containers work
   very well.
2. Opportunistic injection. Content that tries to get the agent to exfiltrate a
   file or fetch an attacker-controlled URL. The broker plus `network_mode:
none` covers a large amount of this.
3. Deliberate exploitation of the container boundary by an attacker who knows
   they are in one. Assume this fails. See non-goals.

## Non-goals

Stated plainly so nobody has to infer them.

**This is not a security boundary strong enough for hostile multi-tenant code
execution in v0.** Do not run untrusted third-party code here on behalf of
other people. Do not build a feature that offers to. The containers in this
repository share the host kernel. A kernel vulnerability, a container runtime
vulnerability, or a misconfiguration reached through some future feature is a
full escape, and the mitigations above raise the cost of that escape without
preventing it.

Also explicitly not goals in v0:

- Docker is not a supported way to run SairiOS. There is no image that boots
  it, and adding one is out of scope.
- Docker is not a release artifact. These images are development tooling.
- The compose project is not a production deployment topology. There is no TLS,
  no authentication between services, no secret management, no backups, and
  ports are loopback-only precisely because none of that exists.
- `openclaw` provider mode is not supported from containers in v0. The gateway
  runs on the host, and reaching it from a container would require an egress
  path that the sandbox design deliberately does not have. Use `make dev`.
- No syscall filtering beyond the Docker default seccomp profile. No AppArmor
  or SELinux profile is written for these containers yet.
- No user namespace remapping. The containers run as a non-root uid, but that
  uid is not remapped to an unprivileged host uid.
- No egress filtering for the services. `network.fetch` is mediated by policy
  in the broker, not by a network policy in the runtime, which means the
  enforcement point is application code.
- No image signing, no SBOM, no provenance attestation, no pinned base image
  digest. `node:22-bookworm-slim` is a moving tag.
- No resource accounting per context. Limits are per container, so two contexts
  sharing a sandbox container share a limit.

## Escalation path

The current posture is deliberately the cheapest thing that is honest about its
own limits. The next steps, roughly in order of cost, for a later milestone:

1. **Pin base images by digest, and add provenance.** Cheap, removes a whole
   class of supply-chain surprise, and makes builds reproducible. Should happen
   first regardless of everything below.
2. **A tightened seccomp profile and a user namespace remap.** Still Docker,
   still a shared kernel, but a much smaller syscall surface and a sandbox uid
   that maps to an unprivileged host uid. Meaningful improvement for the
   accident and opportunistic-injection cases.
3. **gVisor (`runsc`) as the runtime for `tool-sandbox` only.** A userspace
   kernel intercepts syscalls, so a kernel vulnerability is no longer a direct
   escape. The cost is measurable syscall overhead and some incompatibility
   with less common workloads. This is the first option that changes the answer
   to "assume this fails" for a deliberate attacker. The services keep the
   normal runtime; only the sandbox pays the tax.
4. **Firecracker microVMs for tool execution.** A real hardware virtualisation
   boundary with a minimal device model, booting in the low hundreds of
   milliseconds. Escaping requires a hypervisor vulnerability rather than a
   kernel one. The cost is an orchestration layer that does not exist yet: VM
   lifecycle, image build, filesystem plumbing into the workspace volume, and a
   host that supports KVM, which macOS development machines do not.
5. **Per-context microVMs.** The end state that matches the product model. Every
   window is a context, so every context gets its own execution boundary, its
   own workspace, and its own resource accounting. A crystallized context ships
   with a known-good VM image. This is where the "applications are crystallized
   contexts" idea and the isolation story become the same design rather than
   two designs that have to be kept in sync. It is also where per-context
   resource limits, snapshot and restore, and honest multi-tenancy become
   possible.

Until at least step 3 lands, the non-goals section above is the operative
statement of what this protects against.

## Verification status

Nothing in `containers/` has been executed. Docker is not installed on the host
these files were authored on (macOS arm64, no Docker, no QEMU). No image was
built, no container was started, and no health check was observed to pass.

Every command in this document is written from the compose file and the
Dockerfiles rather than from a terminal transcript. Expect to fix things on the
first real run, and replace this section with what actually happened. The
detailed list of specific unverified claims is in `containers/README.md`.
