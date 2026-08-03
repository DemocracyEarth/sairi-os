# syntax=docker/dockerfile:1.7
#
# @sairios/agent-bridge - development container image.
#
#   Docker = service development and tool sandboxing
#   QEMU   = full SairiOS integration testing
#
# This image runs one background service for development. It is not SairiOS.
# It speaks HTTP and WebSocket on port 7802 and nothing else.
#
# OpenClaw is an upstream pinned dependency reached over the gateway protocol.
# No OpenClaw source is vendored into this image, and no OpenClaw binary is
# installed in it. In containers this service runs in `mock` mode, which needs
# no API key, no credentials and no network. See containers/compose.yaml for
# why `openclaw` mode is a host-only path in v0.
#
# VERIFICATION STATUS: never built. Docker is not installed on the authoring
# host (macOS arm64). Every layer below is unexecuted design intent.
#
# Build from the REPOSITORY ROOT, not from containers/:
#   docker build -f containers/agent-bridge.Dockerfile -t sairios/agent-bridge:dev .
#
# BUILD CONTEXT AND .dockerignore: the context is the repository root, so
# Docker reads the root-level .dockerignore, not containers/.dockerignore.
# containers/.dockerignore is the canonical exclude list. To make BuildKit
# honour it for this Dockerfile specifically, place a copy at
# containers/agent-bridge.Dockerfile.dockerignore. See docs/DOCKER.md.

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
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/context-schema ./packages/context-schema
COPY packages/adaptive-ui-schema ./packages/adaptive-ui-schema
COPY services/agent-bridge ./services/agent-bridge

# `tsc --build` follows project references, so this also builds the three
# workspace packages this service depends on.
# The adaptive-ui-schema package precompiles its JSON Schema validator in its
# OWN npm build script (see ADR 0009). `tsc --build` follows TypeScript project
# references but never runs a referenced package's npm scripts, so without this
# line dist/generated/sairi-ui-validator.js is missing and the service dies at
# startup with ERR_MODULE_NOT_FOUND.
RUN npm run build --workspace @sairios/adaptive-ui-schema
RUN npm run build --workspace @sairios/agent-bridge

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
# the builder's. This is also where the `ws` runtime dependency lives.
COPY --from=builder --chown=10001:10001 /build/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /build/package.json ./package.json

COPY --from=builder --chown=10001:10001 /build/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/package.json ./packages/context-schema/
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/dist ./packages/context-schema/dist
COPY --from=builder --chown=10001:10001 /build/packages/adaptive-ui-schema/package.json ./packages/adaptive-ui-schema/
COPY --from=builder --chown=10001:10001 /build/packages/adaptive-ui-schema/dist ./packages/adaptive-ui-schema/dist

# Nested node_modules, and they are NOT optional.
#
# The production ajv@8 does not live at the root. npm hoists the DEV ajv@6
# that eslint pulls in to /build/node_modules, and the prod ajv@8 that the
# schema packages actually import stays nested inside each of them:
#
#   node_modules/ajv                            6.x  (dev, pruned away)
#   packages/context-schema/node_modules/ajv    8.x  (prod, needed)
#   packages/adaptive-ui-schema/node_modules/ajv 8.x (prod, needed)
#
# Copying only /build/node_modules therefore produces an image that builds
# cleanly and dies on its first import:
#
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ajv' imported from
#   /app/packages/context-schema/dist/validate.js
#
# Which is exactly what the first run of this image did.
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/node_modules ./packages/context-schema/node_modules
COPY --from=builder --chown=10001:10001 /build/packages/adaptive-ui-schema/node_modules ./packages/adaptive-ui-schema/node_modules

# Runtime JSON assets, not sources: both schema packages export
# ./src/schema/*.json as a subpath. The SairiUI validator loads the catalog
# from there. Without these files every SairiUI document would fail validation
# at request time.
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/src/schema ./packages/context-schema/src/schema
COPY --from=builder --chown=10001:10001 /build/packages/adaptive-ui-schema/src/schema ./packages/adaptive-ui-schema/src/schema

COPY --from=builder --chown=10001:10001 /build/services/agent-bridge/package.json ./services/agent-bridge/
COPY --from=builder --chown=10001:10001 /build/services/agent-bridge/dist ./services/agent-bridge/dist

# Pre-created so the compose named volume mounted here inherits uid 10001
# ownership instead of being created root-owned.
RUN mkdir -p /app/var && chown 10001:10001 /app/var

# SAIRIOS_BIND_HOST is 0.0.0.0 inside the container only. Host exposure is
# controlled by the 127.0.0.1-bound port mapping in containers/compose.yaml.
#
# SAIRIOS_AGENT_PROVIDER defaults to mock in the image as well as in compose,
# so a bare `docker run` of this image is offline and credential-free too.
ENV NODE_ENV=production \
    SAIRIOS_DATA_DIR=/app/var \
    SAIRIOS_AGENT_BRIDGE_PORT=7802 \
    SAIRIOS_AGENT_PROVIDER=mock \
    SAIRIOS_BIND_HOST=0.0.0.0

EXPOSE 7802

USER 10001:10001

# Node's global fetch. curl and wget are not installed and should not be.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7802/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# No --experimental-sqlite: this service does not open the context store. Only
# the context-service image passes that flag. This matches the `start` script
# in services/agent-bridge/package.json.
CMD ["node", "./services/agent-bridge/dist/main.js"]
