# syntax=docker/dockerfile:1.7
#
# SairiOS tool sandbox - the constrained environment for agent tool execution.
#
#   Docker = service development and tool sandboxing
#   QEMU   = full SairiOS integration testing
#
# This image is not a service. It listens on nothing, answers nothing and
# depends on nothing. It is a place to put an execution.
#
# What it is for: when the permission broker approves a capability that needs
# to run code (files.write into the sandbox, a transform over a context file),
# that execution should happen in an environment where the worst realistic
# outcome is a corrupted /workspace. This image is that environment.
#
# What it is not: a security boundary strong enough for hostile multi-tenant
# code execution. It is a shared-kernel container. See the non-goals section in
# docs/DOCKER.md before treating it as more than defence in depth.
#
# VERIFICATION STATUS: never built. Docker is not installed on the authoring
# host (macOS arm64). Every layer below is unexecuted design intent, including
# the removal step, which asserts its own result at build time but has never
# actually run.
#
# Build from the REPOSITORY ROOT:
#   docker build -f containers/tool-sandbox.Dockerfile -t sairios/tool-sandbox:dev .

FROM node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Deliberate omissions.
#
# This image is defined as much by what is absent as by what is present. Each
# entry below is a thing an attacker who lands here would reach for first.
#
#   npm, npx, corepack, yarn
#       Removed. The sandbox must never be able to install a dependency at
#       runtime. Fetching and running arbitrary code from a registry is
#       exactly the capability this environment exists to prevent, and it
#       would also silently defeat the read-only root filesystem intent.
#
#   curl, wget
#       Removed. `network.fetch` is a capability the permission broker grants,
#       mediates and logs per context. A tool that wants a URL asks the
#       broker. Leaving an HTTP client in the image creates a fetch path that
#       no policy ever sees. The container also runs with network_mode: none
#       in containers/compose.yaml, so these would be useless anyway; removing
#       them means the design does not depend on that one compose line staying
#       correct.
#
#   apt, apt-get, dpkg front ends
#       Removed. Same reason as npm: no runtime software installation, ever.
#
#   git
#       Not present in the base image and not added. Source control is a
#       credential-bearing network client.
#
#   gcc, g++, make, python3, build-essential
#       Not present in the slim base and never added. Nothing here should be
#       compiled. A build toolchain turns a file-write primitive into an
#       arbitrary-binary primitive.
#
#   ssh, openssl CLI, netcat, ping
#       Not added. No outbound anything.
#
#   The Docker socket
#       Never mounted. Not an omission from the image but from
#       containers/compose.yaml, and worth repeating here: a mounted
#       /var/run/docker.sock is host root, and would make the entire
#       permission model theatre.
#
#   The user's home directory
#       Never bind mounted. The only writable path is /workspace, a Docker
#       named volume.
#
# What remains: the Node 22 runtime and the Debian base userland. That is
# already a large attack surface. This list narrows it; it does not close it.
# ---------------------------------------------------------------------------
RUN set -eux; \
    rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /opt/yarn* ; \
    rm -f \
      /usr/bin/curl \
      /usr/bin/wget \
      /usr/bin/apt \
      /usr/bin/apt-get \
      /usr/bin/apt-key \
      /usr/bin/apt-cache \
      /usr/bin/gpg \
      /usr/bin/gpgv ; \
    rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

# Fail the build if anything on the omission list survived. A base image bump
# that quietly reintroduces one of these should break here, loudly, rather than
# be discovered later by an incident.
RUN set -eu; \
    for bin in npm npx corepack yarn curl wget apt apt-get git gcc cc g++ make python python3 ssh nc ncat netcat; do \
      if command -v "$bin" >/dev/null 2>&1; then \
        echo "tool-sandbox image unexpectedly contains: $bin" >&2; \
        exit 1; \
      fi; \
    done; \
    echo "omission assertions passed"

# Dedicated non-root account. uid/gid 10001 matches the `user: 10001:10001`
# line in containers/compose.yaml; keep the two in sync. Deliberately not the
# base image's `node` user (uid 1000), which owns /usr/local/lib/node_modules
# and therefore has more reach than a sandbox principal should.
RUN groupadd --system --gid 10001 sairios \
 && useradd --system --uid 10001 --gid 10001 \
      --home-dir /workspace --shell /usr/sbin/nologin sairios

# The single writable path in the container. Pre-created and chowned in the
# image so that the named volume compose mounts here inherits uid 10001
# ownership instead of being created root-owned.
RUN mkdir -p /workspace && chown 10001:10001 /workspace

WORKDIR /workspace

# HOME points at /workspace because the root filesystem is read-only at
# runtime. Anything that tries to write a dotfile elsewhere fails immediately
# instead of persisting somewhere nobody is looking.
#
# NODE_OPTIONS is left unset on purpose: no --experimental-sqlite here. The
# sandbox has no business opening the context store. Only the context-service
# image passes that flag.
ENV NODE_ENV=production \
    HOME=/workspace \
    SAIRIOS_SANDBOX_DIR=/workspace

# No EXPOSE. There is no port, and adding one would be a design change, not a
# configuration change.

USER 10001:10001

# There is no /healthz because there is no server. The only meaningful
# liveness question for this container is whether its one writable path is
# writable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const fs=require('node:fs');fs.accessSync('/workspace',fs.constants.W_OK)"

# Idle by default. The container exists so that something can be run inside it
# later; it does not start work on its own.
CMD ["node", "-e", "setInterval(() => {}, 1 << 30)"]
