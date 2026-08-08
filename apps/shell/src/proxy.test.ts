import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PREFIXES, createProxy } from '../proxy.mjs';

/**
 * The same-origin proxy.
 *
 * The property most worth defending here is that nothing buffers. The shell
 * consumes NDJSON from the bridge incrementally so it can show an agent
 * working, and a proxy that accumulates the body would turn that into a frozen
 * screen for the length of a model run — a regression nobody would notice in a
 * unit test that only checked the final bytes. So `streams each frame` is
 * written to DEADLOCK rather than to compare strings: the upstream refuses to
 * send its second frame until the client has actually received the first.
 */

interface Rig {
  origin: string;
  /** Requests the upstream saw, in order. */
  seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }>;
}

const open: Server[] = [];

function listen(server: Server): Promise<number> {
  open.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

/** A front server wired exactly as serve.mjs wires it, over a stub upstream. */
async function rig(
  upstream: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<Rig> {
  const seen: Rig['seen'] = [];

  const back = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      upstream(req, res, body);
    });
  });
  const port = await listen(back);

  const { routeFor, forward } = createProxy({ ctx: port, bridge: port, broker: port });
  const front = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = routeFor(url.pathname);
    if (route) return forward(req, res, route, url.search);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('static');
  });
  const frontPort = await listen(front);

  return { origin: `http://127.0.0.1:${frontPort}`, seen };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('routeFor', () => {
  const { routeFor } = createProxy({ ctx: 1, bridge: 2, broker: 3 });

  it('routes each prefix to its own service', () => {
    expect(routeFor('/ctx/contexts')).toEqual({ name: 'ctx', port: 1, path: '/contexts' });
    expect(routeFor('/bridge/intentions')).toEqual({
      name: 'bridge',
      port: 2,
      path: '/intentions',
    });
    expect(routeFor('/broker/requests')).toEqual({ name: 'broker', port: 3, path: '/requests' });
  });

  it('turns a bare prefix into the service root', () => {
    // A service asked for '' rather than '/' answers 404 for its own root.
    expect(routeFor('/ctx')?.path).toBe('/');
  });

  it('does not route a path that merely starts with the same letters', () => {
    // The bug this prevents: `/ctxfoo` reaching the context service, or worse,
    // `/brokerage-report.pdf` being swallowed by the permission broker.
    expect(routeFor('/ctxfoo')).toBeUndefined();
    expect(routeFor('/brokerage')).toBeUndefined();
    expect(routeFor('/bridgework/x')).toBeUndefined();
  });

  it('leaves ordinary shell paths alone', () => {
    for (const path of ['/', '/index.html', '/assets/index-abc.js', '/os', '/favicon.ico']) {
      expect(routeFor(path)).toBeUndefined();
    }
  });
});

describe('forward', () => {
  it('strips the prefix and preserves the query string', async () => {
    const r = await rig((_req, res) => res.end('ok'));
    await fetch(`${r.origin}/broker/requests?contextId=ctx_1&x=2`);
    expect(r.seen[0]?.url).toBe('/requests?contextId=ctx_1&x=2');
  });

  it('passes through methods the static server refuses', async () => {
    // serve.mjs answers 405 to anything but GET/HEAD. The services need POST,
    // PATCH and DELETE, so routing has to happen before that check.
    const r = await rig((_req, res) => res.end('ok'));
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await fetch(`${r.origin}/ctx/contexts`, {
        method,
        ...(method === 'DELETE' ? {} : { body: '{"a":1}' }),
      });
      expect(response.status).toBe(200);
    }
    expect(r.seen.map((s) => s.method)).toEqual(['POST', 'PATCH', 'DELETE']);
  });

  it('forwards the request body', async () => {
    const r = await rig((_req, res) => res.end('ok'));
    await fetch(`${r.origin}/ctx/contexts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intention: 'plan a trip' }),
    });
    expect(JSON.parse(r.seen[0]?.body ?? '{}')).toEqual({ intention: 'plan a trip' });
  });

  it('returns the upstream status and headers', async () => {
    const r = await rig((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json', 'x-sairios': 'yes' });
      res.end('{"error":{"code":"invalid"}}');
    });
    const response = await fetch(`${r.origin}/ctx/contexts`);
    expect(response.status).toBe(422);
    expect(response.headers.get('x-sairios')).toBe('yes');
    expect(await response.json()).toEqual({ error: { code: 'invalid' } });
  });

  it('does not forward hop-by-hop headers', async () => {
    const r = await rig((_req, res) => res.end('ok'));
    await fetch(`${r.origin}/ctx/healthz`, { headers: { te: 'trailers' } });
    expect(r.seen[0]?.headers['te']).toBeUndefined();
  });

  it('rewrites Host to the upstream it actually dialled', async () => {
    const r = await rig((_req, res) => res.end('ok'));
    await fetch(`${r.origin}/bridge/provider`);
    // Not the shell's origin: a service that logs or reflects Host should see
    // where the request landed, not where the browser thought it was going.
    expect(String(r.seen[0]?.headers['host'])).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  it('streams each frame as it arrives instead of buffering the body', async () => {
    let releaseSecond: () => void = () => {};
    const secondFrame = new Promise<void>((resolve) => (releaseSecond = resolve));

    const r = await rig((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"type":"started"}\n');
      // Held until the client confirms it received frame one. If the proxy
      // buffers, that confirmation never comes and this test times out —
      // which is the point.
      void secondFrame.then(() => {
        res.write('{"type":"done"}\n');
        res.end();
      });
    });

    const response = await fetch(`${r.origin}/bridge/intentions`, {
      method: 'POST',
      body: '{}',
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('started');

    releaseSecond();

    const second = await reader.read();
    expect(decoder.decode(second.value)).toContain('done');
  });

  it('answers 502 with a legible sentence when a service is down', async () => {
    // Nothing is listening on this port; createProxy points every prefix at it.
    const { routeFor, forward } = createProxy({ ctx: 1, bridge: 1, broker: 1 });
    const front = createServer((req, res) => {
      const route = routeFor(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      if (route) return forward(req, res, route, '');
      res.end('static');
    });
    const port = await listen(front);

    const response = await fetch(`http://127.0.0.1:${port}/broker/requests`);
    expect(response.status).toBe(502);
    // Names the service, so the reader knows which of the three is missing.
    expect(await response.text()).toContain('broker');
  });
});

describe('dev and production route tables agree', () => {
  it('lists the same prefixes in vite.config.ts as in proxy.mjs', async () => {
    // Two implementations of one mapping, because Vite cannot import the
    // runtime proxy and the runtime proxy must stay dependency-free. This is
    // the assertion that stops them drifting apart silently.
    const config = await readFile(
      fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      'utf8',
    );
    for (const prefix of PREFIXES) {
      expect(config).toContain(`'${prefix}'`);
    }
  });

  it('keeps api.ts on the same prefixes', async () => {
    const api = await readFile(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8');
    for (const prefix of PREFIXES) {
      expect(api).toContain(`?? '${prefix}'`);
    }
  });
});
