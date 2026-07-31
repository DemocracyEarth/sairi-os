#!/usr/bin/env node
/**
 * `make clean` — removes build output.
 *
 * Refuses to touch anything outside the repository, and never deletes `var/`
 * (a user's contexts) or `vm/.cache/` (a multi-gigabyte download) unless asked.
 */
import { rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const TARGETS = [
  'packages/shared/dist',
  'packages/context-schema/dist',
  'packages/adaptive-ui-schema/dist',
  'packages/ui-components/dist',
  'services/context-service/dist',
  'services/permission-broker/dist',
  'services/agent-bridge/dist',
  'apps/shell/dist',
  'apps/shell/dist-types',
  'coverage',
];

if (args.has('--all')) {
  // `var/` holds the user's contexts and the audit log. Only ever on request.
  TARGETS.push('var', 'vm/out', 'vm/.cache', 'node_modules');
}

for (const target of TARGETS) {
  const absolute = resolve(ROOT, target);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || resolve(rel) === ROOT) {
    console.error(`refusing to remove a path outside the repository: ${absolute}`);
    process.exit(1);
  }
  await rm(absolute, { recursive: true, force: true });
  console.log(`removed ${rel}`);
}

// tsbuildinfo files sit next to each project's tsconfig.
for (const project of [
  'packages/shared',
  'packages/context-schema',
  'packages/adaptive-ui-schema',
  'packages/ui-components',
  'services/context-service',
  'services/permission-broker',
  'services/agent-bridge',
  'apps/shell',
]) {
  await rm(resolve(ROOT, project, 'tsconfig.tsbuildinfo'), { force: true });
}

console.log(
  args.has('--all')
    ? '\nEverything removed, including var/ and the VM image cache.'
    : '\nBuild output removed. `make clean-all` also removes var/, the VM cache and node_modules.',
);
