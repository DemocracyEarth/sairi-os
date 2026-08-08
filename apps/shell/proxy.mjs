/**
 * Same-origin reverse proxy for the three SairiOS services.
 *
 * The shell used to address the services by absolute origin —
 * `http://127.0.0.1:7801` and friends, baked into the bundle at build time.
 * That worked exactly as long as the browser was on the same machine, and it
 * cost three things everywhere else:
 *
 *   - the service origins had to be listed in the shell's CSP `connect-src`,
 *     also at build time, so the policy knew the deployment's port numbers;
 *   - every service needed a CORS allow-list naming the shell's origin;
 *   - anything tunnelling the shell had to forward four ports, and forwarding
 *     three of them was a desktop with no data and a console full of errors.
 *
 * Serving everything from one origin under a path prefix deletes all three.
 * `connect-src 'self'` becomes sufficient — the policy gets STRICTER, not
 * looser — CORS stops applying because there is no cross-origin request left to
 * check, and a tunnel needs one port.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately is not
 * ---------------------------------------------------------------------------
 * Not a general proxy. The route table is fixed at module load, the upstream
 * host is a constant, and nothing about the target is derived from the request.
 * A proxy that reads its destination from a header or a path segment is a
 * server-side request forgery primitive, and this one runs in front of a
 * permission broker.
 *
 * It is also NOT authentication. Collapsing four origins into one makes a single
 * authenticated front door *possible*; it does not add one. The services still
 * have no auth, so this must stay bound to loopback exactly as before. See
 * `checkNetworkPosture` in packages/shared/src/env.ts.
 */
import { request as httpRequest } from 'node:http';

/**
 * Services bind loopback and this proxy runs on the same host, so the upstream
 * host is a constant rather than a setting. There is no deployment today that
 * needs otherwise, and an env var pointing this at an arbitrary host would be
 * an SSRF knob sitting in front of the broker.
 */
const UPSTREAM_HOST = '127.0.0.1';

/**
 * Hop-by-hop headers, per RFC 7230 §6.1. These describe a single connection and
 * must not be forwarded to the next one. `transfer-encoding` matters most here:
 * copying it onto a response Node is already re-chunking produces a body the
 * client cannot parse.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const DEFAULT_PORTS = {
  ctx: Number(process.env['SAIRIOS_CONTEXT_SERVICE_PORT'] ?? 7801),
  bridge: Number(process.env['SAIRIOS_AGENT_BRIDGE_PORT'] ?? 7802),
  broker: Number(process.env['SAIRIOS_PERMISSION_BROKER_PORT'] ?? 7803),
};

/** The prefixes, in the order they are tried. Must match `api.ts`. */
export const PREFIXES = ['/ctx', '/bridge', '/broker'];

export function createProxy(ports = DEFAULT_PORTS) {
  /**
   * Resolves a request path to an upstream, or undefined for "serve a file".
   *
   * The prefix must be followed by `/` or end the path, so `/ctxfoo` is a
   * static path and not a sneaky route onto the context service.
   */
  function routeFor(pathname) {
    for (const prefix of PREFIXES) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      const name = prefix.slice(1);
      return {
        name,
        port: ports[name],
        // `/ctx/contexts` -> `/contexts`, and a bare `/ctx` -> `/`. A service
        // asked for '' rather than '/' answers 404 for its own root.
        path: pathname.slice(prefix.length) || '/',
      };
    }
    return undefined;
  }

  /**
   * Forwards one request and streams the response back.
   *
   * Nothing here buffers, and that is the load-bearing property rather than a
   * performance note: `bridgeApi.runIntention` consumes NDJSON incrementally so
   * the shell can show an agent working. A proxy that accumulates the body
   * turns a visible run into a frozen screen for its whole duration, and the
   * duration is model inference time.
   */
  function forward(req, res, route, search = '') {
    const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${route.port}` };
    for (const name of Object.keys(headers)) {
      if (HOP_BY_HOP.has(name.toLowerCase())) delete headers[name];
    }

    const upstream = httpRequest(
      {
        host: UPSTREAM_HOST,
        port: route.port,
        method: req.method,
        path: `${route.path}${search}`,
        headers,
      },
      (from) => {
        const out = {};
        for (const [name, value] of Object.entries(from.headers)) {
          if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
        }
        res.writeHead(from.statusCode ?? 502, out);
        // Nagle would hold a small NDJSON frame back waiting for company. Each
        // frame here is a UI update, so latency beats packet efficiency.
        res.socket?.setNoDelay(true);
        from.pipe(res);
      },
    );

    upstream.on('error', (error) => {
      if (!res.headersSent) {
        res.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        });
        res.end(`the ${route.name} service is not reachable (${error.code ?? error.message})`);
      } else {
        // Mid-stream: the status line is already gone, so the only honest
        // signal left is an incomplete body. Better than a truncated frame
        // that parses as valid.
        res.destroy();
      }
    });

    // A client that navigates away mid-run must not leave the upstream request
    // open — with a long agent run, that is a leaked model call.
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
    });

    req.pipe(upstream);
  }

  return { routeFor, forward };
}
