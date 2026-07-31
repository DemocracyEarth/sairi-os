# containers/

    Docker = service development and tool sandboxing
    QEMU   = full SairiOS integration testing

Docker is not how SairiOS is run as an operating system. There is no image in
this directory that boots SairiOS. There is no compositor, no display server,
no init system, no shell. Nothing here produces the thing a user would call an
operating environment.

What is here is a way to run the three background services in isolation while
developing them, and a constrained environment to put agent tool executions
inside. That is the whole scope.

If you want to see SairiOS as an operating environment, build and run the QEMU
image (`make vm-image`, then `make vm-run`). If you want to develop against the
services with hot reload and your own Node toolchain, run `make dev` on the
host. Docker sits between those two: heavier than `make dev`, and nowhere near
a full system. The decision table is in `docs/DOCKER.md`.

## Files

| File                           | What it is                                                  |
| ------------------------------ | ----------------------------------------------------------- |
| `compose.yaml`                 | The four-container development topology.                    |
| `context-service.Dockerfile`   | Image for `@sairios/context-service` (port 7801).           |
| `agent-bridge.Dockerfile`      | Image for `@sairios/agent-bridge` (port 7802).              |
| `permission-broker.Dockerfile` | Image for `@sairios/permission-broker` (port 7803).         |
| `tool-sandbox.Dockerfile`      | The agent tool execution sandbox. No ports.                 |
| `.dockerignore`                | Build-context exclude list Docker does not read. See below. |

## The compose services

### context-service (port 7801)

Owns contexts: intention, memory, files, tools, agents, permissions, tasks,
events and UI state. It is the only container that touches the context store,
so it is the only one that gets a data volume and the only one whose image
passes `--experimental-sqlite`. Published on `127.0.0.1:7801` only.

### permission-broker (port 7803)

Separates observation, proposal and execution across the 11 capabilities:
`files.read` `files.write` `files.delete` `process.list` `process.execute`
`network.fetch` `browser.open` `clipboard.read` `clipboard.write`
`notifications.send` `system.settings.read`. It is the only component allowed
to execute a capability. It holds the sandbox workspace volume read-write,
because approved file actions are applied by the broker and never by the agent.
Published on `127.0.0.1:7803` only.

### agent-bridge (port 7802)

HTTP plus WebSocket. Reaches OpenClaw as an upstream pinned dependency over the
gateway protocol; no OpenClaw source is vendored into any image here.

In containers this service is pinned to `SAIRIOS_AGENT_PROVIDER=mock`. mock
needs no API key, no credentials and no network, so the whole compose project
stays offline and secret-free. `openclaw` mode is a host-only path in v0: the
gateway runs on the host at `ws://127.0.0.1:18789`, which inside a container
resolves to the container itself. Reaching a host gateway would need an egress
route and a host-gateway alias, both deliberately absent. Use `make dev` for
openclaw mode. Published on `127.0.0.1:7802` only.

### tool-sandbox (no ports)

The constrained execution environment for agent tool calls. It is not a
service. It listens on nothing, answers nothing, and nothing depends on it. It
runs with `network_mode: none` and a single writable path, `/workspace`, backed
by a named volume shared with the permission broker.

Honest v0 limitation: the permission broker cannot drive this container by
itself yet. Driving it would need either the Docker socket (never mounted here)
or an in-container executor that does not exist. Today the container is used to
reproduce and inspect a tool execution by hand, and it is the target image for
that later executor.

## Running it

> **Untested, and internally in tension.** The commands below pass
> `--project-directory .` from the repository root so that `${...}` interpolation reads the
> root `.env`. Every service in `compose.yaml` uses `context: ..`, which Compose resolves
> relative to the compose file's directory — but `--project-directory` changes the project
> directory, and whether that also moves build-context resolution differs between Compose
> versions. If it does, `..` resolves to the PARENT of the repository and every build fails
> immediately.
>
> The `make docker-up` / `make docker-down` targets pass no `--project-directory`, so the
> two entry points do not agree. Nothing here has been run: Docker is not installed on the
> machine this repository was scaffolded on. Before relying on either, run
> `docker compose -f containers/compose.yaml config` and check the resolved `context`
> paths, then make the Makefile and these commands match whichever is correct.

All commands are run from the repository root.

```sh
# Build the four images.
docker compose --project-directory . -f containers/compose.yaml build

# Start the three services. tool-sandbox is not started by default.
docker compose --project-directory . -f containers/compose.yaml up \
  context-service permission-broker agent-bridge

# Health.
curl -s http://127.0.0.1:7801/healthz
curl -s http://127.0.0.1:7802/healthz
curl -s http://127.0.0.1:7803/healthz

# Start and enter the sandbox.
docker compose --project-directory . -f containers/compose.yaml up -d tool-sandbox
docker compose --project-directory . -f containers/compose.yaml exec tool-sandbox sh

# Stop, and remove the named volumes with it.
docker compose --project-directory . -f containers/compose.yaml down -v
```

`--project-directory .` makes the repository-root `.env` the interpolation
source for the `${...}` defaults in `compose.yaml`. Every default is safe
without a `.env` file, and no credential is ever passed into a container.

## Security posture

Applied to every service in `compose.yaml`, through a single shared YAML anchor
so it cannot drift service by service. Each line is commented in place.

- `read_only: true`. The container filesystem is immutable at runtime. A
  compromised process cannot drop a binary or rewrite application code.
- `tmpfs` for `/tmp`, mounted `noexec,nosuid,nodev`, memory backed, wiped on
  exit. This is the scratch space that `read_only` would otherwise remove.
- `cap_drop: [ALL]`. These are plain Node HTTP servers on ports above 1024.
  They need no Linux capabilities at all, so start from zero rather than
  pruning Docker's default set.
- `security_opt: [no-new-privileges:true]`. Without it, dropped capabilities
  are not durable: a setuid binary in the image could regain them.
- `privileged: false`, stated explicitly. It is the default, but
  `privileged: true` silently voids every other line, and a reviewer should be
  able to see it is off without knowing Docker defaults.
- `user: 10001:10001`. A dedicated non-root account created in each
  Dockerfile. Numeric so the compose file is checkable on its own, and high
  enough not to collide with the base image's `node` user at uid 1000.
- `deploy.resources.limits` for `cpus` and `memory`. Compose v2 applies these
  outside Swarm. They bound accidental runaway usage and make a memory leak
  obvious; they are not a defence against a determined attacker.
- `pids_limit`. A fork bomb from a runaway execution exhausts the container's
  process table rather than the host's.
- An explicit user-defined network. Relying on the implicit compose default
  network would make the topology invisible in the file and unreviewable.
  `sairios-svc` carries service-to-service traffic; `sairios-sandbox` is
  declared `internal: true` (no gateway, no NAT, no route off the host) and
  reserved for the escalation path described in `compose.yaml`.
- No Docker socket mount, anywhere. Mounting `/var/run/docker.sock` is
  equivalent to handing out host root and would make the entire permission
  model theatre.
- No bind mount of the user's home directory, or of the repository. All
  writable state is in Docker-managed named volumes.
- One named volume for the sandbox workspace, shared only between
  `permission-broker` and `tool-sandbox`.
- Ports are written `127.0.0.1:HOST:CONTAINER`. The short `HOST:CONTAINER`
  form binds `0.0.0.0` and would expose the context store to the local network.
- `tool-sandbox` runs `network_mode: none`. Not an internal network, not a
  firewalled one: none. `network.fetch` is a capability the broker grants,
  mediates and logs per context. If a tool needs a URL, the broker fetches it
  after a grant and hands the result in. Opening the sandbox's network would
  move that decision out of a policy the user can see and into a default nobody
  reviews.
- The runtime images contain no `curl` and no `wget`; health checks use Node's
  global `fetch` instead. `tool-sandbox` additionally removes `npm`, `npx`,
  `corepack`, `yarn` and the apt front ends, and asserts their absence at build
  time so a base image bump that reintroduces one fails the build.

### Build context and `.dockerignore`

The build context is the repository root, because npm workspaces need the root
`package.json`, the lockfile and every workspace manifest. Docker therefore
reads `<context>/.dockerignore`, which is the repository root, not
`containers/.dockerignore`.

There is no `.dockerignore` at the repository root, so `containers/.dockerignore`
is not in force for any build described here. Docker never reads it. It is the
list this project intends to apply, and it currently excludes nothing.

That belongs in the posture above rather than in a footnote. The whole
repository is uploaded to the daemon as build context, `.env` and `var/`
included. The Dockerfiles do not `COPY . .`, so a repository-root `.env` does
not reach an image layer, but the directory-level copies (`COPY packages/shared
./packages/shared`, and the same shape for each built workspace) take whatever
sits inside those directories: a host `node_modules/`, a stale `dist/`, a
workspace-local `.env` or key file.

Two things would make the list effective. Either add a `.dockerignore` at the
repository root, which is the path Docker reads for these builds on every
builder, or copy this one next to each Dockerfile, which BuildKit resolves as
`<dockerfile>.dockerignore` where that is supported:

```sh
for f in containers/*.Dockerfile; do cp containers/.dockerignore "$f.dockerignore"; done
```

Without one of those, the builds still work. They are slower, the context is
much larger, and none of the exclusions apply.

## Verification status

Nothing in this directory has been executed. Docker is not installed on the
host these files were authored on (macOS arm64, no Docker, no QEMU), and no
image was built, no container was started, and no health check was observed to
pass.

Concretely, all of the following are unverified design intent:

- That the four images build at all.
- That the npm-workspaces layer-caching copy strategy resolves every manifest
  `npm ci` requires.
- That the relative `@sairios/*` symlinks in the pruned `node_modules` resolve
  correctly after being copied into the runtime stage.
- That `--experimental-sqlite` is sufficient for the store on the Node 22 patch
  level that `node:22-bookworm-slim` currently pins.
- That every service actually serves `/healthz`, and that the Node `fetch`
  health check returns within its timeout on a cold start.
- That `deploy.resources.limits` is applied by the Docker Compose version in
  use.
- That the removal step in `tool-sandbox.Dockerfile` finds the paths it removes
  on the current base image.

First person to run this on a machine with Docker: expect to fix things, and
replace this section with what actually happened.

## Threat model and non-goals

Both live in `docs/DOCKER.md`. The short version: model output is untrusted,
retrieved web content carries prompt injection, context files may be malicious,
and a shared-kernel container is not a boundary strong enough for hostile
multi-tenant code execution in v0.
