#!/usr/bin/env node
/**
 * `make dev` — the whole environment in mock mode.
 *
 * Builds the TypeScript projects, starts the three background services on
 * loopback, then starts the shell dev server. No credentials are read and no
 * network call is made.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

/** Minimal .env reader. No dependency, no interpolation, no surprises. */
function loadEnvFile() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile();
// Real environment variables win over .env, so `SAIRIOS_AGENT_PROVIDER=mock make dev` works.
const env = {
  ...process.env,
  ...Object.fromEntries(Object.entries(fileEnv).filter(([k]) => process.env[k] === undefined)),
};
env.SAIRIOS_AGENT_PROVIDER ??= 'mock';
env.SAIRIOS_DATA_DIR ??= resolve(ROOT, 'var');
env.SAIRIOS_BIND_HOST ??= '127.0.0.1';

const PORTS = {
  context: env.SAIRIOS_CONTEXT_SERVICE_PORT ?? '7801',
  bridge: env.SAIRIOS_AGENT_BRIDGE_PORT ?? '7802',
  broker: env.SAIRIOS_PERMISSION_BROKER_PORT ?? '7803',
  shell: env.SAIRIOS_SHELL_PORT ?? '7800',
};

console.log(
  `\n${BOLD}SairiOS${RESET} — starting in ${BOLD}${env.SAIRIOS_AGENT_PROVIDER}${RESET} mode\n`,
);

/**
 * Refuse to start on a busy port.
 *
 * Without this the first service to bind fails with an unhandled EADDRINUSE and
 * prints a Node stack trace, which says nothing about the actual problem: a
 * previous `make dev` is still running.
 */
async function findBusyPorts() {
  const { createServer } = await import('node:net');
  const wanted = [
    ['shell', PORTS.shell],
    ['context-service', PORTS.context],
    ['agent-bridge', PORTS.bridge],
    ['permission-broker', PORTS.broker],
  ];
  const busy = [];
  for (const [name, port] of wanted) {
    const free = await new Promise((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(Number(port), env.SAIRIOS_BIND_HOST);
    });
    if (!free) busy.push({ name, port });
  }
  return busy;
}

const busy = await findBusyPorts();
if (busy.length > 0) {
  console.error(`\nThese ports are already in use:\n`);
  for (const { name, port } of busy) {
    console.error(`  ${String(port).padEnd(6)} ${name}`);
  }
  console.error(
    `\nA previous \`make dev\` is probably still running. Stop it, or find what is
holding the port:

  lsof -nP -iTCP:${busy[0].port} -sTCP:LISTEN

Ports can also be moved in .env (SAIRIOS_SHELL_PORT, SAIRIOS_CONTEXT_SERVICE_PORT,
SAIRIOS_AGENT_BRIDGE_PORT, SAIRIOS_PERMISSION_BROKER_PORT).\n`,
  );
  process.exit(1);
}

console.log(`${DIM}Building TypeScript projects…${RESET}`);
const build = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--build', 'tsconfig.json'],
  { cwd: ROOT, stdio: 'inherit', env },
);
if (build.status !== 0) {
  console.error('\nBuild failed. Fix the errors above and re-run `make dev`.\n');
  process.exit(build.status ?? 1);
}

const SERVICES = [
  { name: 'context-service', entry: 'services/context-service/dist/main.js', port: PORTS.context },
  {
    name: 'permission-broker',
    entry: 'services/permission-broker/dist/main.js',
    port: PORTS.broker,
  },
  { name: 'agent-bridge', entry: 'services/agent-bridge/dist/main.js', port: PORTS.bridge },
];

const children = [];
let shuttingDown = false;

function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${DIM}[${name}]${RESET}`;
  const relay = (stream, target) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        target.write(`${prefix} ${buffer.slice(0, index)}\n`);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\n${prefix} exited with code ${code}. Shutting the stack down.\n`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

for (const service of SERVICES) {
  start(service.name, process.execPath, [resolve(ROOT, service.entry)], ROOT);
}

// Give the services a moment to bind before the shell starts polling them.
await new Promise((r) => setTimeout(r, 600));

start(
  'shell',
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite'],
  resolve(ROOT, 'apps/shell'),
);

console.log(`
${BOLD}SairiOS is starting.${RESET}

  Desktop shell       http://127.0.0.1:${PORTS.shell}
  Context service     http://127.0.0.1:${PORTS.context}/healthz
  Agent bridge        http://127.0.0.1:${PORTS.bridge}/healthz
  Permission broker   http://127.0.0.1:${PORTS.broker}/healthz

  Data directory      ${env.SAIRIOS_DATA_DIR}
  Agent provider      ${env.SAIRIOS_AGENT_PROVIDER}

${DIM}All services are bound to loopback. Press Ctrl-C to stop everything.${RESET}
`);
