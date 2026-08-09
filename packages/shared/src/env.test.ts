import { describe, expect, it } from 'vitest';
import { assertBindSafe, readEnv, startupChecks } from './env.js';

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

  it('errors, not warns, when the services are not bound to loopback', () => {
    // It used to warn, which is to say it did nothing: an operator who set
    // 0.0.0.0 got a log line and a fully exposed permission broker. The
    // services now refuse to start; see assertBindSafe.
    const checks = startupChecks(readEnv({ SAIRIOS_BIND_HOST: '0.0.0.0' }));
    const bind = checks.find((c) => c.name === 'bind-host');
    expect(bind?.status).toBe('error');
    expect(bind?.detail).toContain('NO authentication');
  });

  it('downgrades to a warning once the operator has acknowledged it', () => {
    // Containers legitimately need 0.0.0.0 on an internal network.
    const checks = startupChecks(
      readEnv({
        SAIRIOS_BIND_HOST: '0.0.0.0',
        SAIRIOS_ALLOW_UNAUTHENTICATED_BIND: 'yes-i-understand',
      }),
    );
    expect(checks.find((c) => c.name === 'bind-host')?.status).toBe('warn');
  });

  it('treats an empty SAIRIOS_BIND_HOST as unset rather than as every interface', () => {
    // `listen(port, '')` binds every interface, so the nullish default turned a
    // blank line in a .env into an exposed service.
    expect(readEnv({ SAIRIOS_BIND_HOST: '' }).bindHost).toBe('127.0.0.1');
  });
});

describe('assertBindSafe', () => {
  it('refuses a routable bind with no acknowledgement', () => {
    const message = assertBindSafe(readEnv({ SAIRIOS_BIND_HOST: '0.0.0.0' }), 'test-service');
    expect(message).toContain('refusing to bind');
    expect(message).toContain('SAIRIOS_ALLOW_UNAUTHENTICATED_BIND');
  });

  it('permits loopback, and an acknowledged routable bind', () => {
    expect(assertBindSafe(readEnv({}), 'x')).toBeUndefined();
    expect(
      assertBindSafe(
        readEnv({
          SAIRIOS_BIND_HOST: '0.0.0.0',
          SAIRIOS_ALLOW_UNAUTHENTICATED_BIND: 'yes-i-understand',
        }),
        'x',
      ),
    ).toBeUndefined();
  });

  it('is not satisfied by a truthy-but-wrong acknowledgement', () => {
    // The value is a deliberate sentence, not a boolean, so nobody sets it by
    // copying `=true` from another variable.
    for (const value of ['true', '1', 'yes', 'YES-I-UNDERSTAND']) {
      const env = readEnv({
        SAIRIOS_BIND_HOST: '0.0.0.0',
        SAIRIOS_ALLOW_UNAUTHENTICATED_BIND: value,
      });
      expect(assertBindSafe(env, 'x')).toBeDefined();
    }
  });
});
