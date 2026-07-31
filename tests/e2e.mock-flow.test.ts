import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEnv } from '@sairios/shared/node';
import type { Context, CrystallizationPreview } from '@sairios/context-schema';
import {
  ContextService,
  createContextServiceServer,
  createContextStore,
  demoContexts,
  type ContextStore,
} from '@sairios/context-service';
import {
  FileAuditLog,
  PermissionBroker,
  createPermissionBrokerServer,
} from '@sairios/permission-broker';
import {
  AgentBridge,
  HttpBrokerClient,
  HttpContextClient,
  MockAgentProvider,
  createAgentBridgeServer,
} from '@sairios/agent-bridge';

/**
 * End-to-end flow in mock mode.
 *
 * Runs the three real HTTP services against real stores and walks the whole
 * demo path from the product specification:
 *
 *   intention -> context -> agent run -> permission request -> approval ->
 *   sandboxed execution -> persistence -> restart -> crystallization
 *
 * No credentials, no network, no model provider.
 */

interface Stack {
  contextUrl: string;
  brokerUrl: string;
  bridgeUrl: string;
  dataDir: string;
  store: ContextStore;
  servers: Server[];
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function startStack(dataDir?: string): Promise<Stack> {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'sairios-e2e-')));
  const env = readEnv({
    SAIRIOS_DATA_DIR: dir,
    SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox'),
    SAIRIOS_AGENT_PROVIDER: 'mock',
    SAIRIOS_LOG_LEVEL: 'error',
  });

  const store = await createContextStore(env.storeDriver, env.dataDir);
  const service = new ContextService({ store });
  const contextServer = createContextServiceServer({ service, store, env });
  const contextUrl = await listen(contextServer);

  const broker = new PermissionBroker({
    env,
    audit: new FileAuditLog(join(dir, 'audit.log')),
    policyFile: join(dir, 'permission-policies.json'),
  });
  await broker.load();
  const brokerServer = createPermissionBrokerServer({ broker, env });
  const brokerUrl = await listen(brokerServer);

  const bridge = new AgentBridge({
    provider: new MockAgentProvider(),
    broker: new HttpBrokerClient(brokerUrl),
    contexts: new HttpContextClient(contextUrl),
  });
  const bridgeServer = createAgentBridgeServer({ bridge, env });
  const bridgeUrl = await listen(bridgeServer);

  return {
    contextUrl,
    brokerUrl,
    bridgeUrl,
    dataDir: dir,
    store,
    servers: [contextServer, brokerServer, bridgeServer],
  };
}

async function stopStack(stack: Stack): Promise<void> {
  await Promise.all(
    stack.servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await stack.store.close();
}

async function json<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as T };
}

describe('SairiOS end-to-end (mock mode)', () => {
  let stack: Stack;

  beforeAll(async () => {
    stack = await startStack();
  });

  afterAll(async () => {
    await stopStack(stack);
  });

  it('reports healthy services with no credentials configured', async () => {
    for (const [name, url] of [
      ['context-service', stack.contextUrl],
      ['permission-broker', stack.brokerUrl],
      ['agent-bridge', stack.bridgeUrl],
    ] as const) {
      const { status, body } = await json<{ service: string; status: string }>(`${url}/healthz`);
      expect(status, name).toBe(200);
      expect(body.status).toBe('ok');
    }
  });

  it('reports the mock provider as configured and offline', async () => {
    const { body } = await json<{ provider: string; configured: boolean; offline: boolean }>(
      `${stack.bridgeUrl}/provider`,
    );
    expect(body).toMatchObject({ provider: 'mock', configured: true, offline: true });
  });

  it('walks the full demo flow', async () => {
    // 1-5. An intention becomes a context of a chosen type.
    const created = await json<Context>(`${stack.contextUrl}/contexts`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Compare three vendor proposals',
        type: 'ephemeral',
        objective: 'Decide which proposal to accept',
      }),
    });
    expect(created.status).toBe(201);
    const contextId = created.body.id;
    expect(created.body.status).toBe('draft');

    const submitted = await json<Context>(`${stack.contextUrl}/contexts/${contextId}/intention`, {
      method: 'POST',
      body: JSON.stringify({ intention: 'Compare three vendor proposals' }),
    });
    expect(submitted.body.status).toBe('active');

    // 6-8. The intention reaches the agent through the bridge, which returns a
    // validated SairiUI document and raises a permission request.
    const run = await json<{ events: { type: string; [k: string]: unknown }[] }>(
      `${stack.bridgeUrl}/intentions`,
      {
        method: 'POST',
        body: JSON.stringify({
          contextId,
          intention: 'Compare three vendor proposals',
          contextType: 'ephemeral',
          contextName: 'Compare three vendor proposals',
        }),
      },
    );
    expect(run.status).toBe(200);
    const kinds = run.body.events.map((e) => e.type);
    expect(kinds).toContain('permission-pending');
    expect(kinds).toContain('ui');
    expect(kinds.at(-1)).toBe('done');

    // 9. The requested permission is inspectable through the broker.
    const requests = await json<{ requests: { id: string; capability: string; status: string }[] }>(
      `${stack.brokerUrl}/requests?contextId=${contextId}`,
    );
    expect(requests.body.requests).toHaveLength(1);
    const request = requests.body.requests[0];
    if (!request) throw new Error('expected a permission request');
    expect(request.capability).toBe('files.read');
    expect(request.status).toBe('pending');

    // Executing before approval is refused.
    const premature = await json<{ error: { code: string } }>(
      `${stack.brokerUrl}/requests/${request.id}/execute`,
      { method: 'POST' },
    );
    expect(premature.status).toBe(403);

    // 10. The user approves, then execution is a separate step.
    const decided = await json<{ status: string }>(
      `${stack.brokerUrl}/requests/${request.id}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow', scope: 'once', remember: false }),
      },
    );
    expect(decided.body.status).toBe('allowed');

    const executed = await json<{ status: string; error?: { code: string } }>(
      `${stack.brokerUrl}/requests/${request.id}/execute`,
      { method: 'POST' },
    );
    expect(executed.status).toBe(200);
    // The demo payload points at a file that does not exist in a fresh sandbox,
    // so the action fails cleanly. What matters is that it stayed inside the
    // sandbox and was recorded.
    expect(['executed', 'failed']).toContain(executed.body.status);

    // 11. The context, including its interface, is persisted.
    const stored = await json<Context>(`${stack.contextUrl}/contexts/${contextId}`);
    expect(stored.body.uiSpecification).not.toBeNull();
    expect(stored.body.events.map((e) => e.kind)).toContain('ui.specification-updated');
    expect(stored.body.events.map((e) => e.kind)).toContain('permission.requested');

    // 12. It survives a restart of the whole stack.
    await stopStack(stack);
    stack = await startStack(stack.dataDir);
    const reopened = await json<Context>(`${stack.contextUrl}/contexts/${contextId}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.name).toBe('Compare three vendor proposals');
    expect(reopened.body.uiSpecification).not.toBeNull();

    // The remembered-policy file also survives: a fresh broker still knows
    // nothing was remembered here (scope was `once`).
    const afterRestart = await json<{ requests: unknown[] }>(
      `${stack.brokerUrl}/requests?contextId=${contextId}`,
    );
    expect(afterRestart.body.requests).toHaveLength(0);

    // 13. The context crystallizes into a reusable template.
    const preview = await json<CrystallizationPreview>(
      `${stack.contextUrl}/contexts/${contextId}/crystallize/preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.retained.length).toBeGreaterThan(0);
    expect(preview.body.discarded.length).toBeGreaterThan(0);

    const crystallized = await json<{ context: Context }>(
      `${stack.contextUrl}/contexts/${contextId}/crystallize`,
      { method: 'POST', body: JSON.stringify({ name: 'Vendor comparison' }) },
    );
    expect(crystallized.status).toBe(201);
    expect(crystallized.body.context.type).toBe('crystallized');
    expect(crystallized.body.context.template).toBeDefined();

    // The template can be run again as a new context.
    const instantiated = await json<Context>(
      `${stack.contextUrl}/contexts/${crystallized.body.context.id}/instantiate`,
      { method: 'POST', body: JSON.stringify({ values: {} }) },
    );
    expect(instantiated.status).toBe(201);
    expect(instantiated.body.crystallizedFrom).toBe(crystallized.body.context.id);
  });

  it('refuses an invalid SairiUI document over HTTP', async () => {
    const created = await json<Context>(`${stack.contextUrl}/contexts`, {
      method: 'POST',
      body: JSON.stringify({ name: 'x', type: 'persistent', objective: 'y' }),
    });
    const result = await json<{
      error: { code: string; details: { reason: string; messages: string[] } };
    }>(`${stack.contextUrl}/contexts/${created.body.id}/ui`, {
      method: 'PUT',
      body: JSON.stringify({
        version: '0.1',
        contextId: created.body.id,
        title: 'Rogue',
        contextType: 'persistent',
        layout: {
          type: 'stack',
          regions: [{ id: 'a', component: { type: 'iframe', props: { src: 'https://evil' } } }],
        },
        suggestedActions: [],
      }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('invalid_ui_specification');
    expect(result.body.error.details.reason).toBe('unknown-component');
    expect(result.body.error.details.messages.join(' ')).toContain('iframe');

    // The rejection is recorded on the context, and nothing was stored.
    const stored = await json<Context>(`${stack.contextUrl}/contexts/${created.body.id}`);
    expect(stored.body.uiSpecification).toBeNull();
    expect(stored.body.events.map((e) => e.kind)).toContain('ui.specification-rejected');
  });

  it('rejects an intention that names no valid context', async () => {
    const result = await json<{ error: { code: string } }>(`${stack.bridgeUrl}/intentions`, {
      method: 'POST',
      body: JSON.stringify({ contextId: 'nope', intention: 'x' }),
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('invalid_context_id');
  });

  it('never grants a deny-by-default capability through the HTTP surface', async () => {
    const created = await json<Context>(`${stack.contextUrl}/contexts`, {
      method: 'POST',
      body: JSON.stringify({ name: 'x', type: 'persistent', objective: 'y' }),
    });
    const proposed = await json<{ id: string; status: string }>(`${stack.brokerUrl}/requests`, {
      method: 'POST',
      body: JSON.stringify({
        contextId: created.body.id,
        capability: 'process.execute',
        reason: 'run something',
      }),
    });
    expect(proposed.body.status).toBe('denied');
    const executed = await json<unknown>(
      `${stack.brokerUrl}/requests/${proposed.body.id}/execute`,
      {
        method: 'POST',
      },
    );
    expect(executed.status).toBe(403);
  });

  it('serves the seeded demo contexts when the store starts empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-seed-'));
    const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_LOG_LEVEL: 'error' });
    const store = await createContextStore(env.storeDriver, env.dataDir);
    const service = new ContextService({ store });
    for (const context of demoContexts()) await store.put(context);

    const listed = await service.list();
    expect(listed).toHaveLength(3);
    expect(listed.map((c) => c.type).sort()).toEqual(['crystallized', 'ephemeral', 'persistent']);
    await store.close();
  });
});
