import { describe, expect, it } from 'vitest';
import { readEnv, startupChecks } from './env.js';

/**
 * The peer-URL split matters: `bindHost` answers "where do I listen", and in a
 * container it must be 0.0.0.0. Reusing it to dial a peer reaches the caller's
 * own loopback instead, which is exactly the bug this separation prevents.
 */
describe('peer service URLs', () => {
  it('default to loopback, never to the bind host', () => {
    const env = readEnv({ SAIRIOS_BIND_HOST: '0.0.0.0' });
    expect(env.bindHost).toBe('0.0.0.0');
    expect(env.contextServiceUrl).toBe('http://127.0.0.1:7801');
    expect(env.permissionBrokerUrl).toBe('http://127.0.0.1:7803');
  });

  it('follow the configured ports when no explicit URL is given', () => {
    const env = readEnv({
      SAIRIOS_CONTEXT_SERVICE_PORT: '9001',
      SAIRIOS_PERMISSION_BROKER_PORT: '9003',
    });
    expect(env.contextServiceUrl).toBe('http://127.0.0.1:9001');
    expect(env.permissionBrokerUrl).toBe('http://127.0.0.1:9003');
  });

  it('are overridable for a multi-container deployment', () => {
    const env = readEnv({
      SAIRIOS_BIND_HOST: '0.0.0.0',
      SAIRIOS_CONTEXT_SERVICE_URL: 'http://context-service:7801',
      SAIRIOS_PERMISSION_BROKER_URL: 'http://permission-broker:7803',
    });
    expect(env.contextServiceUrl).toBe('http://context-service:7801');
    expect(env.permissionBrokerUrl).toBe('http://permission-broker:7803');
  });

  it('treats an empty override as unset rather than as an empty URL', () => {
    const env = readEnv({ SAIRIOS_CONTEXT_SERVICE_URL: '' });
    expect(env.contextServiceUrl).toBe('http://127.0.0.1:7801');
  });
});

describe('startup checks', () => {
  it('reports mock mode as fully configured with no credentials', () => {
    const checks = startupChecks(readEnv({}));
    const provider = checks.find((c) => c.name === 'agent-provider');
    expect(provider?.status).toBe('ok');
    expect(provider?.detail).toContain('no API key');
  });

  it('warns when openclaw is selected without a gateway token', () => {
    const checks = startupChecks(readEnv({ SAIRIOS_AGENT_PROVIDER: 'openclaw' }));
    expect(checks.find((c) => c.name === 'agent-provider')?.status).toBe('warn');
  });

  it('warns loudly when the services are not bound to loopback', () => {
    const checks = startupChecks(readEnv({ SAIRIOS_BIND_HOST: '0.0.0.0' }));
    const bind = checks.find((c) => c.name === 'bind-host');
    expect(bind?.status).toBe('warn');
    expect(bind?.detail).toContain('NO authentication');
  });
});
