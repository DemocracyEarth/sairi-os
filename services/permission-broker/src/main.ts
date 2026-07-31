import { join } from 'node:path';
import { createLogger } from '@sairios/shared';
import { attachListenDiagnostics, readEnv, startupChecks } from '@sairios/shared/node';
import { FileAuditLog } from './audit.js';
import { PermissionBroker } from './broker.js';
import { createPermissionBrokerServer } from './server.js';

const env = readEnv();
const log = createLogger('permission-broker');

const broker = new PermissionBroker({
  env,
  audit: new FileAuditLog(join(env.dataDir, 'audit.log')),
  policyFile: join(env.dataDir, 'permission-policies.json'),
});

await broker.load();

for (const check of startupChecks(env)) {
  const line = `${check.name}: ${check.detail}`;
  if (check.status === 'error') log.error(line);
  else if (check.status === 'warn') log.warn(line);
  else log.info(line);
}

const server = createPermissionBrokerServer({ broker, env, logger: log });

attachListenDiagnostics(server, {
  service: 'permission-broker',
  host: env.bindHost,
  port: env.permissionBrokerPort,
  onFatal: (message) => log.error(message),
});

server.listen(env.permissionBrokerPort, env.bindHost, () => {
  log.info('permission broker listening', {
    url: `http://${env.bindHost}:${env.permissionBrokerPort}`,
    sandbox: env.sandboxDir,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
