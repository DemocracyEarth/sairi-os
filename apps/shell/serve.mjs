#!/usr/bin/env node
/**
 * Serves the built SairiOS shell.
 *
 * Why this exists rather than `vite preview`:
 *
 *   1. `vite preview` is a development convenience, not a server. To load a
 *      TypeScript config it writes a temp file into node_modules/.vite-temp,
 *      which fails outright under the units' `ProtectSystem=strict`:
 *
 *        Error: EROFS: read-only file system, open
 *        '/opt/sairios/node_modules/.vite-temp/vite.config.ts.timestamp-….mjs'
 *
 *      Loosening the sandbox so a build tool can write into the product tree
 *      would trade a real confinement for a convenience.
 *
 *   2. It drags the whole build toolchain into the runtime. With this, the guest
 *      can install with `npm ci --omit=dev` and never carry vite or TypeScript
 *      onto a machine that only needs to serve static files.
 *
 * Node standard library only, no dependencies, no writes. It reads from `dist`
 * and nothing else: every request path is resolved and checked against the root,
 * so a traversal attempt gets a 403 rather than a file.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const HOST = process.env['SAIRIOS_BIND_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['SAIRIOS_SHELL_PORT'] ?? 7800);

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
  }),
);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
    }

    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const requested = decodeURIComponent(url.pathname);

    // Resolve, then prove the result is inside the root. `normalize` alone is not
    // enough: only the containment check makes traversal impossible.
    let target = resolve(join(ROOT, normalize(requested)));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      return send(res, 403, 'forbidden');
    }

    let info = await stat(target).catch(() => undefined);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => undefined);
    }

    // Single-page fallback: unknown paths render the shell, which then routes.
    // Asset paths are excluded so a genuine 404 for a missing bundle is not
    // disguised as an HTML page.
    if (!info?.isFile()) {
      if (requested.startsWith('/assets/')) return send(res, 404, 'not found');
      target = join(ROOT, 'index.html');
      info = await stat(target).catch(() => undefined);
      if (!info?.isFile()) {
        return send(res, 500, `the shell is not built: ${ROOT}/index.html is missing`);
      }
    }

    const type = TYPES.get(extname(target).toLowerCase()) ?? 'application/octet-stream';
    // Hashed asset filenames may be cached hard; index.html must not be, or a
    // rebuilt shell keeps serving the previous bundle.
    const cache = target.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';

    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(target).pipe(res);
  })().catch(() => {
    if (!res.headersSent) send(res, 500, 'internal error');
    else res.end();
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(
      `sairios-shell: ${HOST}:${PORT} is already in use. Another instance is running.\n`,
    );
  } else {
    process.stderr.write(`sairios-shell: ${error.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`sairios-shell: serving ${ROOT} on http://${HOST}:${PORT}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
