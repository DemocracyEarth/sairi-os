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
import { CAPABILITY_DESCRIPTORS, DEFAULT_POLICIES } from './policy.js';
import type { PermissionBroker } from './broker.js';

/**
 * Loopback-only HTTP surface for the permission broker.
 *
 * There is no authentication here by design: the service must never be exposed
 * beyond loopback, and `startupChecks` warns loudly when it is. Adding a token
 * would imply a security property this boundary does not have.
 */

export interface ServerDeps {
  broker: PermissionBroker;
  env: SairiEnv;
  logger?: Logger;
}

export function createPermissionBrokerServer(deps: ServerDeps): Server {
  const log = deps.logger ?? createLogger('permission-broker');
  const allowedOrigins = loopbackOrigins([deps.env.shellPort, 5173]);

  return createServer((req, res) => {
    void handle().catch((cause: unknown) => {
      log.error('unhandled request failure', { error: cause });
      if (!res.headersSent) sendError(res, 500, 'internal_error', 'Unexpected failure.');
    });

    async function handle(): Promise<void> {
      if (applyDevCors(req, res, allowedOrigins)) return;

      const url = new URL(req.url ?? '/', `http://${deps.env.bindHost}`);
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/healthz') {
        sendJson(res, 200, {
          service: 'permission-broker',
          status: 'ok',
          checks: startupChecks(deps.env),
        });
        return;
      }

      // --- observation ---
      if (method === 'GET' && path === '/capabilities') {
        sendJson(res, 200, {
          capabilities: Object.values(CAPABILITY_DESCRIPTORS).map((d) => ({
            ...d,
            defaultPolicy: DEFAULT_POLICIES[d.capability],
          })),
        });
        return;
      }

      if (method === 'GET' && path === '/policies') {
        sendJson(res, 200, deps.broker.policySnapshot());
        return;
      }

      if (method === 'GET' && path === '/audit') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 500);
        const contextId = url.searchParams.get('contextId') ?? undefined;
        sendJson(res, 200, { records: await deps.broker.auditRecent(limit, contextId) });
        return;
      }

      // --- proposal ---
      if (method === 'POST' && path === '/requests') {
        const body = await readJsonBody(req);
        if (!body.ok) return sendError(res, 400, body.code, body.message);
        const input = body.value as Record<string, unknown>;
        const result = await deps.broker.propose({
          contextId: String(input?.['contextId'] ?? ''),
          capability: String(input?.['capability'] ?? ''),
          reason: String(input?.['reason'] ?? ''),
          payload: input?.['payload'],
        });
        if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
        return sendJson(res, 201, result.value);
      }

      if (method === 'GET' && path === '/requests') {
        const contextId = url.searchParams.get('contextId');
        const pendingOnly = url.searchParams.get('pending') === 'true';
        const requests = pendingOnly
          ? deps.broker.pending(contextId ?? undefined)
          : contextId
            ? deps.broker.forContext(contextId)
            : deps.broker.pending();
        return sendJson(res, 200, { requests });
      }

      const requestMatch = /^\/requests\/(req_[0-9a-f]{32})(?:\/(decision|execute|cancel))?$/.exec(
        path,
      );
      if (requestMatch) {
        const [, requestId, action] = requestMatch;
        if (!requestId) return sendError(res, 400, 'invalid_request_id', 'Malformed request id.');

        if (method === 'GET' && !action) {
          const found = deps.broker.get(requestId);
          if (!found) return sendError(res, 404, 'unknown_request', 'No such permission request.');
          return sendJson(res, 200, found);
        }

        if (method === 'POST' && action === 'decision') {
          const body = await readJsonBody(req);
          if (!body.ok) return sendError(res, 400, body.code, body.message);
          const input = body.value as Record<string, unknown>;
          const result = await deps.broker.decide(requestId, {
            decision: input?.['decision'] === 'allow' ? 'allow' : 'deny',
            scope: input?.['scope'] === 'context' ? 'context' : 'once',
            remember: input?.['remember'] === true,
            global: input?.['global'] === true,
          });
          if (!result.ok) return sendError(res, 409, result.error.code, result.error.message);
          return sendJson(res, 200, result.value);
        }

        // --- execution ---
        if (method === 'POST' && action === 'execute') {
          const result = await deps.broker.execute(requestId);
          if (!result.ok) return sendError(res, 403, result.error.code, result.error.message);
          return sendJson(res, 200, result.value);
        }

        if (method === 'POST' && action === 'cancel') {
          const result = await deps.broker.cancel(requestId);
          if (!result.ok) return sendError(res, 409, result.error.code, result.error.message);
          return sendJson(res, 200, result.value);
        }
      }

      sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
    }
  });
}
