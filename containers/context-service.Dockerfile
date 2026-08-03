# syntax=docker/dockerfile:1.7
#
# @sairios/context-service - development container image.
#
#   Docker = service development and tool sandboxing
#   QEMU   = full SairiOS integration testing
#
# This image runs one background service for development. It is not SairiOS.
# Building and running it gives you an HTTP API on port 7801, not an operating
# environment.
#
# VERIFICATION STATUS: never built. Docker is not installed on the authoring
# host (macOS arm64). Every layer below is unexecuted design intent.
#
# Build from the REPOSITORY ROOT, not from containers/:
#   docker build -f containers/context-service.Dockerfile -t sairios/context-service:dev .
#
# BUILD CONTEXT AND .dockerignore: the context is the repository root, so
# Docker reads the root-level .dockerignore, not containers/.dockerignore.
# containers/.dockerignore is the canonical exclude list for this project. To
# make BuildKit honour it for this Dockerfile specifically, place a copy at
# containers/context-service.Dockerfile.dockerignore. See docs/DOCKER.md.

# ---------------------------------------------------------------------------
# Stage 1: builder
#
# Full toolchain, all dev dependencies, TypeScript compilation. Nothing from
# this stage reaches the runtime image except built artifacts.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# npm-workspaces copy strategy, part 1: manifests only.
#
# `npm ci` in a workspace root needs the root package.json, the lockfile, and
# EVERY workspace manifest, because the lockfile describes the whole tree and
# npm refuses to install a partial workspace set. Copying just those files
# first means the expensive `npm ci` layer is cached and only invalidates when
# a dependency actually changes, not on every source edit.
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

# Deterministic install from the lockfile. Not `npm install`: `npm ci` fails
# loudly if the lockfile and manifests disagree, which is what you want in a
# build.
RUN npm ci

# npm-workspaces copy strategy, part 2: sources.
#
# Everything above this line changes rarely; everything below changes on every
# commit. apps/shell sources are not copied because this service never imports
# them and copying them would bust this layer on unrelated frontend edits.
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/context-schema ./packages/context-schema
COPY packages/adaptive-ui-schema ./packages/adaptive-ui-schema
COPY services/context-service ./services/context-service

# `tsc --build` follows TypeScript project references, so building this one
# workspace also builds the three packages it depends on, in order.
# The adaptive-ui-schema package precompiles its JSON Schema validator in its
# OWN npm build script (see ADR 0009). `tsc --build` follows TypeScript project
# references but never runs a referenced package's npm scripts, so without this
# line dist/generated/sairi-ui-validator.js is missing and the service dies at
# startup with ERR_MODULE_NOT_FOUND.
RUN npm run build --workspace @sairios/adaptive-ui-schema
RUN npm run build --workspace @sairios/context-service

# Drop dev dependencies from the installed tree now that compilation is done.
# The pruned node_modules is what gets copied into the runtime stage.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
#
# Same base image, no build toolchain, no dev dependencies, no TypeScript
# sources beyond the JSON schema assets that are exported at runtime.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Dedicated system account. uid/gid 10001 matches the `user: 10001:10001`
# line in containers/compose.yaml; keep the two in sync. A high, fixed,
# numeric id makes the compose file readable without consulting /etc/passwd,
# and avoids colliding with the image's built-in `node` user (uid 1000).
RUN groupadd --system --gid 10001 sairios \
 && useradd --system --uid 10001 --gid 10001 \
      --home-dir /app --shell /usr/sbin/nologin sairios

WORKDIR /app

# node_modules first: it is the largest layer and changes least often.
# Copied whole because npm workspaces installs @sairios/* as relative symlinks
# under node_modules that resolve against ./packages and ./services. The
# directory layout below has to match the builder's for those links to resolve.
COPY --from=builder --chown=10001:10001 /build/node_modules ./node_modules

# Root manifest only, so `npm start`-style resolution and `type: module` work.
COPY --from=builder --chown=10001:10001 /build/package.json ./package.json

# Production artifacts, package by package: compiled output plus each
# manifest. src/ is deliberately excluded, with one exception below.
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

# The exception: both schema packages publish a subpath export pointing at
# ./src/schema/*.json. Those JSON documents are runtime assets, not sources.
# Omitting them breaks SairiUI validation at request time rather than at build
# time, which is the worst place to find out.
COPY --from=builder --chown=10001:10001 /build/packages/context-schema/src/schema ./packages/context-schema/src/schema
COPY --from=builder --chown=10001:10001 /build/packages/adaptive-ui-schema/src/schema ./packages/adaptive-ui-schema/src/schema

COPY --from=builder --chown=10001:10001 /build/services/context-service/package.json ./services/context-service/
COPY --from=builder --chown=10001:10001 /build/services/context-service/dist ./services/context-service/dist

# Create the data directory in the image so the named volume mounted here by
# compose inherits uid 10001 ownership on first use. A volume mounted onto a
# path that does not exist in the image is created root-owned, and a non-root
# process then cannot write to it.
RUN mkdir -p /app/var && chown 10001:10001 /app/var

# SAIRIOS_BIND_HOST is 0.0.0.0 inside the container only. Host exposure is
# controlled by the 127.0.0.1-bound port mapping in containers/compose.yaml.
ENV NODE_ENV=production \
    SAIRIOS_DATA_DIR=/app/var \
    SAIRIOS_CONTEXT_SERVICE_PORT=7801 \
    SAIRIOS_BIND_HOST=0.0.0.0

EXPOSE 7801

USER 10001:10001

# Node's global fetch. curl and wget are not installed and should not be.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7801/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# --experimental-sqlite is required HERE and only here. context-service is the
# only service that opens the node:sqlite store; on Node 22 that module is
# behind the flag (it became unflagged in 23.4). The other two service images
# do not pass it. This matches the `start` script in
# services/context-service/package.json.
#
# With SAIRIOS_STORE_DRIVER=json the flag is unused but harmless.
CMD ["node", "--experimental-sqlite", "./services/context-service/dist/main.js"]
