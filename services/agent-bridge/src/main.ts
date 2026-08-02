import { resolve } from 'node:path';
import { createLogger } from '@sairios/shared';
import { attachListenDiagnostics, readEnv, startupChecks } from '@sairios/shared/node';
import { AgentBridge } from './bridge.js';
import { HttpBrokerClient, HttpContextClient } from './clients.js';
import { MockAgentProvider } from './providers/mock.js';
import { OpenClawAgentProvider } from './providers/openclaw.js';
import { WsGatewayTransport } from './providers/ws-transport.js';
import { createAgentBridgeServer } from './server.js';
import { ProviderSetup } from './setup.js';
import type { AgentProvider } from './provider.js';

const env = readEnv();
const log = createLogger('agent-bridge');

const provider: AgentProvider =
  env.agentProvider === 'openclaw'
    ? new OpenClawAgentProvider({
        gatewayUrl: env.openclawGatewayUrl,
        gatewayToken: env.openclawGatewayToken,
        versionFile: resolve(process.cwd(), 'openclaw/config/version.json'),
        transport: new WsGatewayTransport(),
      })
    : new MockAgentProvider({ stepDelayMs: 220 });

const bridge = new AgentBridge({
  provider,
  broker: new HttpBrokerClient(env.permissionBrokerUrl),
  contexts: new HttpContextClient(env.contextServiceUrl),
  logger: log,
});

const status = await provider.status();
log.info(`provider ${status.provider}: ${status.detail}`);
if (!status.configured) {
  log.warn('the selected provider is not configured; intentions will return an explanatory error');
}

for (const check of startupChecks(env)) {
  const line = `${check.name}: ${check.detail}`;
  if (check.status === 'error') log.error(line);
  else if (check.status === 'warn') log.warn(line);
  else log.info(line);
}

/**
 * Both files live under the bridge's own data directory, which the service
 * account owns. Nothing here needs root: the OpenClaw gateway unit runs as the
 * same account and reads the credential through `EnvironmentFile=`.
 */
const setup = new ProviderSetup({
  envFilePath: resolve(env.dataDir, 'agent-bridge/provider.env'),
  statePath: resolve(env.dataDir, 'agent-bridge/provider.json'),
  gatewayUrl: env.openclawGatewayUrl,
  logger: log,
});

const setupStatus = await setup.status();
log.info(
  setupStatus.configured
    ? `provider configured: ${setupStatus.provider} (${setupStatus.model})`
    : 'no model provider configured yet; first-run setup will ask for one',
);

const server = createAgentBridgeServer({ bridge, env, logger: log, setup });

attachListenDiagnostics(server, {
  service: 'agent-bridge',
  host: env.bindHost,
  port: env.agentBridgePort,
  onFatal: (message) => log.error(message),
});

server.listen(env.agentBridgePort, env.bindHost, () => {
  log.info('agent bridge listening', {
    url: `http://${env.bindHost}:${env.agentBridgePort}`,
    provider: provider.name,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
