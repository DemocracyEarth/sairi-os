import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * One test project for the whole monorepo.
 *
 * Workspace packages resolve to their sources so `make test` needs no build
 * step. Tests default to the node environment; UI tests opt into jsdom with a
 * `@vitest-environment jsdom` docblock.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Anchored so a package alias cannot swallow a subpath export
    // (see the note in apps/shell/vite.config.ts).
    alias: [
      {
        find: '@sairios/ui-components/styles.css',
        replacement: src('./packages/ui-components/src/styles.css'),
      },
      { find: /^@sairios\/shared$/, replacement: src('./packages/shared/src/index.ts') },
      {
        find: /^@sairios\/context-schema$/,
        replacement: src('./packages/context-schema/src/index.ts'),
      },
      {
        find: /^@sairios\/adaptive-ui-schema$/,
        replacement: src('./packages/adaptive-ui-schema/src/index.ts'),
      },
      {
        find: /^@sairios\/ui-components$/,
        replacement: src('./packages/ui-components/src/index.ts'),
      },
      {
        find: /^@sairios\/context-service$/,
        replacement: src('./services/context-service/src/index.ts'),
      },
      {
        find: /^@sairios\/permission-broker$/,
        replacement: src('./services/permission-broker/src/index.ts'),
      },
      {
        find: /^@sairios\/agent-bridge$/,
        replacement: src('./services/agent-bridge/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: false,
    // `os` is in the list for os/branding/palette.test.ts, which guards the
    // generated palette against drifting from the tokens it derives from.
    include: ['{packages,services,apps,tests,examples,os}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'vm/**', 'containers/**'],
    // No test may reach the network or a paid API. A slow test is a broken test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
  },
});
