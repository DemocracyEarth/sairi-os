import { createServer, type Server } from 'node:http';
import type { ContextStatus, ContextType } from '@sairios/context-schema';
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
import type { ContextService } from './service.js';
import type { ContextStore } from './store.js';

/**
 * Loopback-only HTTP surface for the context service.
 *
 * Every handler returns a Result-shaped error rather than throwing, so a
 * malformed request from the shell or the agent bridge produces a legible
 * message instead of a 500.
 */

export interface ServerDeps {
  service: ContextService;
  store: ContextStore;
  env: SairiEnv;
  logger?: Logger;
}

const CONTEXT_PATH = /^\/contexts\/(ctx_[0-9a-f]{32})(?:\/([a-z-]+)(?:\/([a-z-]+))?)?$/;

export function createContextServiceServer(deps: ServerDeps): Server {
  const log = deps.logger ?? createLogger('context-service');
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
        return sendJson(res, 200, {
          service: 'context-service',
          status: 'ok',
          storeDriver: deps.store.driver,
          contexts: (await deps.service.list()).length,
          checks: startupChecks(deps.env),
        });
      }

      if (method === 'GET' && path === '/contexts') {
        const filter: { type?: ContextType; status?: ContextStatus } = {};
        const type = url.searchParams.get('type');
        const status = url.searchParams.get('status');
        if (type) filter.type = type as ContextType;
        if (status) filter.status = status as ContextStatus;
        return sendJson(res, 200, { contexts: await deps.service.list(filter) });
      }

      if (method === 'POST' && path === '/contexts') {
        const body = await readJsonBody(req);
        if (!body.ok) return sendError(res, 400, body.code, body.message);
        const input = (body.value ?? {}) as Record<string, unknown>;
        const result = await deps.service.create({
          name: String(input['name'] ?? ''),
          type: input['type'] as ContextType,
          objective: String(input['objective'] ?? ''),
        });
        if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
        return sendJson(res, 201, result.value);
      }

      const match = CONTEXT_PATH.exec(path);
      if (match) {
        const id = match[1];
        const segment = match[2];
        const sub = match[3];
        if (!id) return sendError(res, 400, 'invalid_id', 'Malformed context id.');

        if (method === 'GET' && !segment) {
          const found = await deps.service.get(id);
          if (!found) return sendError(res, 404, 'not_found', 'No such context.');
          return sendJson(res, 200, found);
        }

        if (method === 'DELETE' && !segment) {
          const result = await deps.service.delete(id);
          return sendJson(res, result.ok && result.value ? 200 : 404, {
            deleted: result.ok && result.value,
          });
        }

        if (method === 'PATCH' && !segment) {
          const body = await readJsonBody(req);
          if (!body.ok) return sendError(res, 400, body.code, body.message);
          const input = (body.value ?? {}) as Record<string, unknown>;
          const result = await deps.service.rename(id, String(input['name'] ?? ''));
          if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
          return sendJson(res, 200, result.value);
        }

        if (method === 'GET' && segment === 'crystallize' && sub === 'preview') {
          const result = await deps.service.previewCrystallize(id);
          if (!result.ok) return sendError(res, 404, result.error.code, result.error.message);
          return sendJson(res, 200, result.value);
        }

        if (method === 'POST') {
          const body = await readJsonBody(req);
          if (!body.ok) return sendError(res, 400, body.code, body.message);
          const input = (body.value ?? {}) as Record<string, unknown>;

          switch (segment) {
            case 'intention': {
              const result = await deps.service.submitIntention(
                id,
                String(input['intention'] ?? ''),
              );
              if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
              return sendJson(res, 200, result.value);
            }
            case 'status': {
              const result = await deps.service.setStatus(id, input['status'] as ContextStatus);
              if (!result.ok) return sendError(res, 409, result.error.code, result.error.message);
              return sendJson(res, 200, result.value);
            }
            case 'tasks': {
              const result = await deps.service.addTask(id, String(input['title'] ?? ''));
              if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
              return sendJson(res, 201, result.value);
            }
            case 'crystallize': {
              const options: Parameters<ContextService['crystallize']>[1] = {};
              if (typeof input['name'] === 'string') options.name = input['name'];
              if (typeof input['instructions'] === 'string')
                options.instructions = input['instructions'];
              const result = await deps.service.crystallize(id, options);
              if (!result.ok) return sendError(res, 409, result.error.code, result.error.message);
              return sendJson(res, 201, result.value);
            }
            case 'instantiate': {
              const result = await deps.service.instantiate(id, {
                ...(typeof input['name'] === 'string' ? { name: input['name'] } : {}),
                ...(input['type'] === 'persistent' ? { type: 'persistent' as const } : {}),
                ...(typeof input['values'] === 'object' && input['values'] !== null
                  ? { values: input['values'] as Record<string, string> }
                  : {}),
              });
              if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
              return sendJson(res, 201, result.value);
            }
            case 'events': {
              const result = await deps.service.appendEventTo(
                id,
                input['kind'] as Parameters<ContextService['appendEventTo']>[1],
                String(input['summary'] ?? ''),
                typeof input['data'] === 'object' && input['data'] !== null
                  ? (input['data'] as Record<string, unknown>)
                  : undefined,
              );
              if (!result.ok) return sendError(res, 400, result.error.code, result.error.message);
              return sendJson(res, 201, result.value);
            }
            default:
              break;
          }
        }

        if (method === 'PUT' && segment === 'ui') {
          const body = await readJsonBody(req);
          if (!body.ok) return sendError(res, 400, body.code, body.message);
          const result = await deps.service.setUiSpecification(id, body.value);
          if (!result.ok) {
            // 422: the request was well-formed but the model's document is not
            // renderable. The shell distinguishes this from a transport error.
            return sendJson(res, 422, { error: result.error });
          }
          return sendJson(res, 200, result.value);
        }
      }

      sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
    }
  });
}
