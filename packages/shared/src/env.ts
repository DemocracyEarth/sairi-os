import { resolve } from 'node:path';

/**
 * Central environment resolution.
 *
 * Two rules hold everywhere in SairiOS:
 *  1. Services bind to loopback unless the operator opts out explicitly.
 *  2. The absence of any credential is a supported, fully functional state
 *     (`mock` mode) — never a startup failure.
 */

export type AgentProviderName = 'mock' | 'openclaw';
export type StoreDriver = 'sqlite' | 'json' | 'auto';

export interface SairiEnv {
  agentProvider: AgentProviderName;
  bindHost: string;
  contextServicePort: number;
  agentBridgePort: number;
  permissionBrokerPort: number;
  shellPort: number;
  dataDir: string;
  sandboxDir: string;
  storeDriver: StoreDriver;
  /**
   * Where to REACH the peer services, which is not the same question as where
   * to listen. `bindHost` is often `0.0.0.0` (in a container, it must be), and
   * dialling `0.0.0.0` reaches the caller's own loopback, not the peer. These
   * default to loopback and are overridden per deployment.
   */
  contextServiceUrl: string;
  permissionBrokerUrl: string;
  openclawGatewayUrl: string;
  openclawGatewayToken: string | undefined;
  logLevel: string;
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): SairiEnv {
  const provider = source['SAIRIOS_AGENT_PROVIDER'];
  const driver = source['SAIRIOS_STORE_DRIVER'];
  const dataDir = resolve(source['SAIRIOS_DATA_DIR'] ?? './var');
  const contextPort = num(source['SAIRIOS_CONTEXT_SERVICE_PORT'], 7801);
  const brokerPort = num(source['SAIRIOS_PERMISSION_BROKER_PORT'], 7803);

  return {
    agentProvider: provider === 'openclaw' ? 'openclaw' : 'mock',
    bindHost: source['SAIRIOS_BIND_HOST'] ?? '127.0.0.1',
    contextServicePort: contextPort,
    agentBridgePort: num(source['SAIRIOS_AGENT_BRIDGE_PORT'], 7802),
    permissionBrokerPort: brokerPort,
    shellPort: num(source['SAIRIOS_SHELL_PORT'], 7800),
    // An empty string is treated as unset, so a `.env` that lists the variable
    // without a value still gets the loopback default.
    contextServiceUrl: source['SAIRIOS_CONTEXT_SERVICE_URL'] || `http://127.0.0.1:${contextPort}`,
    permissionBrokerUrl:
      source['SAIRIOS_PERMISSION_BROKER_URL'] || `http://127.0.0.1:${brokerPort}`,
    dataDir,
    sandboxDir: resolve(source['SAIRIOS_SANDBOX_DIR'] ?? `${dataDir}/sandbox`),
    storeDriver: driver === 'sqlite' || driver === 'json' ? driver : 'auto',
    openclawGatewayUrl: source['OPENCLAW_GATEWAY_URL'] ?? 'ws://127.0.0.1:18789',
    openclawGatewayToken: source['OPENCLAW_GATEWAY_TOKEN'] || undefined,
    logLevel: source['SAIRIOS_LOG_LEVEL'] ?? 'info',
  };
}

export interface StartupCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

/**
 * Human-readable startup diagnosis. Returned by every service on `/healthz` and
 * printed by `make doctor`, so a misconfigured provider produces a clear
 * sentence rather than a stack trace three layers down.
 */
export function startupChecks(env: SairiEnv): StartupCheck[] {
  const checks: StartupCheck[] = [];

  if (env.agentProvider === 'mock') {
    checks.push({
      name: 'agent-provider',
      status: 'ok',
      detail: 'mock provider active — deterministic responses, no network, no API key required',
    });
  } else {
    checks.push({
      name: 'agent-provider',
      status: env.openclawGatewayToken ? 'ok' : 'warn',
      detail: env.openclawGatewayToken
        ? `openclaw provider targeting ${env.openclawGatewayUrl}`
        : `openclaw provider selected but OPENCLAW_GATEWAY_TOKEN is empty. ` +
          `Run OpenClaw onboarding (see docs/OPENCLAW.md) or set SAIRIOS_AGENT_PROVIDER=mock.`,
    });
  }

  const loopback =
    env.bindHost === '127.0.0.1' || env.bindHost === '::1' || env.bindHost === 'localhost';
  checks.push({
    name: 'bind-host',
    status: loopback ? 'ok' : 'warn',
    detail: loopback
      ? `services bound to loopback (${env.bindHost})`
      : `services bound to ${env.bindHost} — SairiOS services have NO authentication and must not be reachable off-host`,
  });

  checks.push({
    name: 'sandbox',
    status: 'ok',
    detail: `agent file actions confined to ${env.sandboxDir}`,
  });

  return checks;
}
