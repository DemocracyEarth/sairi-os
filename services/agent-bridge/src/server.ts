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
import { providerCatalogue, type ProviderSetup } from './setup.js';

/**
 * Loopback-only HTTP surface for the agent bridge.
 *
 * `POST /intentions` streams newline-delimited JSON events. The shell reads it
 * with `fetch` + a ReadableStream, so no WebSocket client is shipped to the
 * browser. Clients that send `Accept: application/json` get the collected
 * events in one response instead, which is what the tests use.
 *
 * `/setup` is the provider-configuration surface used by first-run setup. It is
 * write-only with respect to the credential: a key goes in through POST, and no
 * route anywhere returns one. See setup.ts for why.
 */

export interface ServerDeps {
  bridge: AgentBridge;
  env: SairiEnv;
  logger?: Logger;
  /** Absent in deployments that configure their provider some other way. */
  setup?: ProviderSetup;
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

      if (url.pathname === '/setup') {
        if (!deps.setup) {
          return sendError(
            res,
            501,
            'setup_unavailable',
            'This deployment does not manage provider credentials.',
          );
        }

        if (method === 'GET') {
          // Deliberately no key, no key prefix, no key length. "Configured" is
          // the only thing a caller needs, and the only thing on offer.
          return sendJson(res, 200, {
            ...(await deps.setup.status()),
            providers: providerCatalogue(),
          });
        }

        if (method === 'POST') {
          const body = await readJsonBody(req);
          if (!body.ok) return sendError(res, 400, body.code, body.message);
          const input = (body.value ?? {}) as Record<string, unknown>;

          // The request body is never logged: it holds the key.
          const result = await deps.setup.configure({
            provider: input['provider'],
            model: input['model'],
            apiKey: input['apiKey'],
          });

          if (!result.ok) {
            const status = result.error.code === 'onboarding_failed' ? 502 : 400;
            return sendError(res, status, result.error.code, result.error.message);
          }
          log.info('provider configured', { provider: result.value.provider });
          return sendJson(res, 200, result.value);
        }

        return sendError(res, 405, 'method_not_allowed', 'Use GET or POST.');
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
