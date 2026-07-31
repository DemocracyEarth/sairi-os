import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const SHELL_PORT = Number(process.env['SAIRIOS_SHELL_PORT'] ?? 7800);
const CONTEXT_PORT = Number(process.env['SAIRIOS_CONTEXT_SERVICE_PORT'] ?? 7801);
const BRIDGE_PORT = Number(process.env['SAIRIOS_AGENT_BRIDGE_PORT'] ?? 7802);
const BROKER_PORT = Number(process.env['SAIRIOS_PERMISSION_BROKER_PORT'] ?? 7803);

/**
 * Injects the shell's Content Security Policy into the built index.html.
 *
 * Build only. The dev server needs inline scripts for React Refresh, and
 * loosening the policy to `'unsafe-inline'` so that dev and production match
 * would trade a real production control for tidiness.
 *
 * The shell renders agent-produced *descriptions*, never agent-produced code,
 * so it needs no `eval` and no remote scripts. `style-src 'unsafe-inline'` is
 * required by React's `style` prop, used only for progress widths and status
 * colours; `script-src` stays `'self'`.
 */
function csp(): Plugin {
  const services = [CONTEXT_PORT, BRIDGE_PORT, BROKER_PORT]
    .flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
    .join(' ');

  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${services}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  return {
    name: 'sairios-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

/**
 * Workspace packages are aliased to their sources so the dev server gives
 * hot reload across the monorepo without a build step. `tsc --build` still
 * consumes the declaration output, so types and runtime stay in agreement.
 */
export default defineConfig({
  plugins: [react(), csp()],
  resolve: {
    // Anchored regexes, not bare strings: a string alias is a PREFIX match, so
    // `@sairios/ui-components` would also swallow the
    // `@sairios/ui-components/styles.css` subpath export and rewrite it to
    // `.../src/index.ts/styles.css`.
    alias: [
      {
        find: '@sairios/ui-components/styles.css',
        replacement: root('../../packages/ui-components/src/styles.css'),
      },
      { find: /^@sairios\/shared$/, replacement: root('../../packages/shared/src/index.ts') },
      {
        find: /^@sairios\/context-schema$/,
        replacement: root('../../packages/context-schema/src/index.ts'),
      },
      {
        find: /^@sairios\/adaptive-ui-schema$/,
        replacement: root('../../packages/adaptive-ui-schema/src/index.ts'),
      },
      {
        find: /^@sairios\/ui-components$/,
        replacement: root('../../packages/ui-components/src/index.ts'),
      },
    ],
  },
  server: {
    // Loopback only. The shell must not be reachable from the network.
    host: '127.0.0.1',
    port: SHELL_PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: SHELL_PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
