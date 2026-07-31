import { createLogger } from '@sairios/shared';
import { attachListenDiagnostics, readEnv, startupChecks } from '@sairios/shared/node';
import { demoContexts } from './seeds.js';
import { createContextServiceServer } from './server.js';
import { ContextService } from './service.js';
import { createContextStore } from './store.js';

const env = readEnv();
const log = createLogger('context-service');

const store = await createContextStore(env.storeDriver, env.dataDir, log);
const service = new ContextService({ store });

// Seed the three demo contexts on an empty store only. Re-running never
// overwrites the user's work.
if ((await service.list()).length === 0) {
  for (const context of demoContexts()) {
    await store.put(context);
  }
  log.info('seeded demo contexts', { count: demoContexts().length });
}

for (const check of startupChecks(env)) {
  const line = `${check.name}: ${check.detail}`;
  if (check.status === 'error') log.error(line);
  else if (check.status === 'warn') log.warn(line);
  else log.info(line);
}

const server = createContextServiceServer({ service, store, env, logger: log });

attachListenDiagnostics(server, {
  service: 'context-service',
  host: env.bindHost,
  port: env.contextServicePort,
  onFatal: (message) => log.error(message),
});

server.listen(env.contextServicePort, env.bindHost, () => {
  log.info('context service listening', {
    url: `http://${env.bindHost}:${env.contextServicePort}`,
    store: store.driver,
    dataDir: env.dataDir,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => {
      void store.close().then(() => process.exit(0));
    });
  });
}
