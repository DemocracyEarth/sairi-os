# syntax=docker/dockerfile:1.7
#
# @sairios/permission-broker - development container image.
#
#   Docker = service development and tool sandboxing
#   QEMU   = full SairiOS integration testing
#
# This image runs one background service for development. It is not SairiOS.
#
# The broker is the only component allowed to execute a capability, and it
# separates observation, proposal and execution across the 11 capabilities
# (files.read files.write files.delete process.list process.execute
# network.fetch browser.open clipboard.read clipboard.write
# notifications.send system.settings.read). There is no unrestricted shell
# path from a model into this container: no shell helper is installed, no
# Docker socket is mounted by containers/compose.yaml, and agent file actions
# are confined to SAIRIOS_SANDBOX_DIR.
#
# VERIFICATION STATUS: never built. Docker is not installed on the authoring
# host (macOS arm64). Every layer below is unexecuted design intent.
#
# Build from the REPOSITORY ROOT, not from containers/:
#   docker build -f containers/permission-broker.Dockerfile -t sairios/permission-broker:dev .
#
# BUILD CONTEXT AND .dockerignore: the context is the repository root, so
# Docker reads the root-level .dockerignore, not containers/.dockerignore.
# containers/.dockerignore is the canonical exclude list. To make BuildKit
# honour it for this Dockerfile specifically, place a copy at
# containers/permission-broker.Dockerfile.dockerignore. See docs/DOCKER.md.

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# npm-workspaces copy strategy, part 1: manifests only.
#
# `npm ci` in a workspace root needs the root package.json, the lockfile, and
# EVERY workspace manifest, because the lockfile describes the whole tree.
# Copying only manifests first keeps the expensive install layer cached until a
# dependency genuinely changes.
#
# apps/shell and packages/ui-components are listed even though this service
# does not depend on them: without their manifests `npm ci` fails on a missing
# workspace.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/context-schema/package.json ./packages/context-schema/
COPY packages/adaptive-ui-schema/package.json ./packages/adaptive-ui-schema/
COPY packages/ui-components/package.json ./packages/ui-components/
COPY services/context-service/package.json ./services/context-service/
COPY services/agent-bridge/package.json ./services/agent-bridge/
COPY services/permission-broker/package.json ./services/permission-broker/
COPY apps/shell/package.json ./apps/shell/

RUN npm ci

# npm-workspaces copy strategy, part 2: sources. Everything above changes
# rarely, everything below changes on every commit.
#
# packages/adaptive-ui-schema is NOT copied: the broker declares no dependency
# on it. If its tsconfig ever grows a project reference to that package, the
# `tsc --build` below will fail on a missing directory, and the fix is to add
# the COPY line here rather than to weaken the reference.
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/context-schema ./packages/context-schema
COPY services/permission-broker ./services/permission-broker

# `tsc --build` follows project references, so this also builds the workspace
# packages this service depends on.
RUN npm run build --workspace @sairios/permission-broker

RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# uid/gid 10001 matches `user: 10001:10001` in containers/compose.yaml.
RUN groupadd --system --gid 10001 sairios \
 && useradd --system --uid 10001 --gid 10001 \
      --home-dir /app --shell /usr/sbin/nologin sairios

WORKDIR /app

# Copied whole: npm workspaces installs @sairios/* as relative symlinks that
# resolve against ./packages and ./services, so the runtime layout has to match
# the builder's.
COPY --from=builder --chown=10001:10001 /build/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /build/package.json ./package.json

COPY --from=builder --chown=10001:10001 /build/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/package.json ./packages/context-schema/
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/dist ./packages/context-schema/dist

# Runtime JSON asset, not source: context-schema exports
# ./src/schema/context.schema.json as a subpath and the broker validates
# against it. Omitting it turns a build-time mistake into a request-time one.
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/src/schema ./packages/context-schema/src/schema

COPY --from=builder --chown=10001:10001 /build/services/permission-broker/package.json ./services/permission-broker/
COPY --from=builder --chown=10001:10001 /build/services/permission-broker/dist ./services/permission-broker/dist

# Two writable paths, both pre-created so the compose named volumes mounted
# onto them inherit uid 10001 ownership rather than being created root-owned:
#   /app/var    policy store and the capability audit log
#   /workspace  the sandbox workspace, shared with the tool-sandbox container
RUN mkdir -p /app/var /workspace \
 && chown 10001:10001 /app/var /workspace

# SAIRIOS_BIND_HOST is 0.0.0.0 inside the container only. Host exposure is
# controlled by the 127.0.0.1-bound port mapping in containers/compose.yaml.
#
# SAIRIOS_SANDBOX_DIR points at /workspace, the only path outside /app the
# broker may write. It is never the repository and never the user's home.
ENV NODE_ENV=production \
    SAIRIOS_DATA_DIR=/app/var \
    SAIRIOS_PERMISSION_BROKER_PORT=7803 \
    SAIRIOS_SANDBOX_DIR=/workspace \
    SAIRIOS_BIND_HOST=0.0.0.0

EXPOSE 7803

USER 10001:10001

# Node's global fetch. curl and wget are not installed and should not be.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7803/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# No --experimental-sqlite: the broker does not open the node:sqlite context
# store. Only the context-service image passes that flag. This matches the
# `start` script in services/permission-broker/package.json.
CMD ["node", "./services/permission-broker/dist/main.js"]
