import { createServer, type Server } from 'node:http';
import { createLogger, type Logger } from '@sairios/shared';
import {
  applyDevCors,
  loopbackOrigins,
  readJsonBody,
  sendError,
  sendJson,
  startupChecks,
  type SairiEnv,
} from '@sairios/shared/node';
import type { AgentBridge } from './bridge.js';

/**
 * Loopback-only HTTP surface for the agent bridge.
 *
 * `POST /intentions` streams newline-delimited JSON events. The shell reads it
 * with `fetch` + a ReadableStream, so no WebSocket client is shipped to the
 * browser. Clients that send `Accept: application/json` get the collected
 * events in one response instead, which is what the tests use.
 */

export interface ServerDeps {
  bridge: AgentBridge;
  env: SairiEnv;
  logger?: Logger;
}

export function createAgentBridgeServer(deps: ServerDeps): Server {
  const log = deps.logger ?? createLogger('agent-bridge');
  const allowedOrigins = loopbackOrigins([deps.env.shellPort, 5173]);

  return createServer((req, res) => {
    void handle().catch((cause: unknown) => {
      log.error('unhandled request failure', { error: cause });
      if (!res.headersSent) sendError(res, 500, 'internal_error', 'Unexpected failure.');
      else res.end();
    });

    async function handle(): Promise<void> {
      if (applyDevCors(req, res, allowedOrigins)) return;

      const url = new URL(req.url ?? '/', `http://${deps.env.bindHost}`);
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, {
          service: 'agent-bridge',
          status: 'ok',
          provider: await deps.bridge.status(),
          checks: startupChecks(deps.env),
        });
      }

      if (method === 'GET' && url.pathname === '/provider') {
        return sendJson(res, 200, await deps.bridge.status());
      }

      if (method === 'POST' && url.pathname === '/intentions') {
        const body = await readJsonBody(req);
        if (!body.ok) return sendError(res, 400, body.code, body.message);
        const input = (body.value ?? {}) as Record<string, unknown>;

        const contextId = String(input['contextId'] ?? '');
        if (!/^ctx_[0-9a-f]{32}$/.test(contextId)) {
          return sendError(res, 400, 'invalid_context_id', 'A valid context id is required.');
        }
        const intention = String(input['intention'] ?? '').trim();
        if (!intention)
          return sendError(res, 400, 'invalid_input', 'An intention cannot be empty.');

        const run = deps.bridge.run({
          contextId,
          intention: intention.slice(0, 4000),
          contextType:
            input['contextType'] === 'persistent'
              ? 'persistent'
              : input['contextType'] === 'crystallized'
                ? 'crystallized'
                : 'ephemeral',
          contextName: String(input['contextName'] ?? 'Untitled context').slice(0, 200),
        });

        const wantsStream = (req.headers.accept ?? '').includes('application/x-ndjson');
        if (!wantsStream) {
          const events = [];
          for await (const event of run) events.push(event);
          return sendJson(res, 200, { events });
        }

        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...(res.getHeader('access-control-allow-origin')
            ? {
                'access-control-allow-origin': String(res.getHeader('access-control-allow-origin')),
              }
            : {}),
        });
        for await (const event of run) {
          if (res.writableEnded) break;
          res.write(`${JSON.stringify(event)}\n`);
        }
        res.end();
        return;
      }

      sendError(res, 404, 'not_found', `No route for ${method} ${url.pathname}`);
    }
  });
}
