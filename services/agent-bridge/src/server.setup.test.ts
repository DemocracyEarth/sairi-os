import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@sairios/shared';
import { readEnv } from '@sairios/shared/node';
import { AgentBridge } from './bridge.js';
import { MockAgentProvider } from './providers/mock.js';
import { createAgentBridgeServer } from './server.js';
import { ProviderSetup } from './setup.js';
import type { Server } from 'node:http';

/**
 * The `/setup` routes at the HTTP boundary.
 *
 * setup.test.ts covers the module. This covers the surface a browser actually
 * touches, because that is where a key would leak if it leaked at all.
 */

const FAKE_KEY = `sk-ant-${'0'.repeat(40)}`;
const MODEL = 'anthropic/claude-opus-5';

let server: Server;
let base: string;
let dir: string;

const noopBroker = {
  request: async () => ({ ok: true as const, value: { decision: 'denied' as const } }),
};

async function start(withSetup: boolean): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'sairios-setup-http-'));
  const logger = createLogger('test');
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_AGENT_BRIDGE_PORT: '0' });

  const bridge = new AgentBridge({
    provider: new MockAgentProvider({ stepDelayMs: 0 }),
    broker: noopBroker as never,
    contexts: { saveUi: async () => ({ ok: true as const, value: undefined }) } as never,
    logger,
  });

  const setup = new ProviderSetup({
    envFilePath: join(dir, 'provider.env'),
    statePath: join(dir, 'provider.json'),
    gatewayUrl: 'ws://127.0.0.1:18789',
    logger,
    // Never spawns anything. `--version` succeeds so openclaw reads as present.
    runOpenclaw: async () => ({ stdout: '2026.7.1-2', stderr: '' }),
  });

  server = createAgentBridgeServer({
    bridge,
    env,
    logger,
    ...(withSetup ? { setup } : {}),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise((done) => server.close(done));
});

describe('GET /setup', () => {
  beforeEach(() => start(true));

  it('offers a catalogue a person can choose from', async () => {
    const body = (await (await fetch(`${base}/setup`)).json()) as Record<string, unknown>;
    expect(body['configured']).toBe(false);
    expect(Array.isArray(body['providers'])).toBe(true);
    expect((body['providers'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('never returns a key, not even after one has been set', async () => {
    await fetch(`${base}/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY }),
    });

    const raw = await (await fetch(`${base}/setup`)).text();
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain(FAKE_KEY.slice(0, 12));
    expect(JSON.parse(raw)).toMatchObject({ configured: true, keyPresent: true });
  });
});

describe('POST /setup', () => {
  beforeEach(() => start(true));

  async function post(payload: unknown) {
    const response = await fetch(`${base}/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('accepts a well-formed configuration', async () => {
    const { status, body } = await post({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });
    expect(status).toBe(200);
    expect(body).toMatchObject({ configured: true, provider: 'anthropic' });
  });

  it('answers 400 with a legible code for bad input', async () => {
    const { status, body } = await post({ provider: 'acme', model: MODEL, apiKey: FAKE_KEY });
    expect(status).toBe(400);
    expect((body['error'] as { code: string }).code).toBe('unknown_provider');
  });

  it('does not echo the key back in an error response', async () => {
    const response = await fetch(`${base}/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Wrong provider for this key, so the request fails after the key is read.
      body: JSON.stringify({ provider: 'openai', model: MODEL, apiKey: FAKE_KEY }),
    });
    expect(await response.text()).not.toContain(FAKE_KEY);
  });
});

describe('when the deployment does not manage credentials', () => {
  beforeEach(() => start(false));

  it('answers 501 so the shell can hide setup rather than show a broken form', async () => {
    const response = await fetch(`${base}/setup`);
    expect(response.status).toBe(501);
  });
});
