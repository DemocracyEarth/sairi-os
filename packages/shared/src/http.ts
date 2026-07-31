import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Minimal HTTP helpers shared by the three background services.
 *
 * Deliberately dependency-free: the services expose a handful of loopback-only
 * JSON endpoints, and a framework would add supply-chain surface for no benefit.
 */

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

/** Bodies larger than this are rejected outright — model output is untrusted. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(payload),
    // These services render into a desktop shell; nothing here should ever be framed.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { error: { code, message } });
}

export async function readJsonBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      return {
        ok: false,
        code: 'payload_too_large',
        message: `body exceeds ${MAX_BODY_BYTES} bytes`,
      };
    }
    chunks.push(buf);
  }
  if (total === 0) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch (cause) {
    return {
      ok: false,
      code: 'invalid_json',
      message: cause instanceof Error ? cause.message : 'invalid JSON',
    };
  }
}

/**
 * CORS for the Vite dev server only. Origins are checked against an explicit
 * loopback allowlist — never `*`, because these endpoints perform privileged
 * operations on behalf of the local user.
 */
export function applyDevCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

export function loopbackOrigins(ports: readonly number[]): string[] {
  return ports.flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]);
}

/**
 * Turns a failed `listen` into a sentence instead of a stack trace.
 *
 * An unhandled EADDRINUSE prints a Node trace that says nothing about the real
 * problem, which is almost always a previous run still holding the port. These
 * services are started by `make dev`, by systemd and by Docker, so the
 * explanation belongs with the server rather than in one launcher.
 */
export function attachListenDiagnostics(
  server: { on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown },
  options: { service: string; host: string; port: number; onFatal?: (message: string) => void },
): void {
  server.on('error', (error: NodeJS.ErrnoException) => {
    const { service, host, port } = options;
    let message: string;
    switch (error.code) {
      case 'EADDRINUSE':
        message =
          `${service} cannot start: ${host}:${port} is already in use. ` +
          `Another SairiOS instance is probably running. Find it with ` +
          `\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`, or choose another port in .env.`;
        break;
      case 'EACCES':
        message =
          `${service} cannot start: permission denied binding ${host}:${port}. ` +
          `Ports below 1024 need privileges SairiOS deliberately does not take.`;
        break;
      case 'EADDRNOTAVAIL':
        message = `${service} cannot start: ${host} is not an address on this machine.`;
        break;
      default:
        message = `${service} cannot start: ${error.message}`;
    }
    (options.onFatal ?? ((m: string) => process.stderr.write(`${m}\n`)))(message);
    process.exit(1);
  });
}
