#!/usr/bin/env node
/**
 * `make doctor` — environment diagnosis.
 *
 * Answers one question: what can this machine actually do with SairiOS right
 * now? Reports facts, never guesses, and exits non-zero only when something
 * required for `make dev` is missing. QEMU and Docker are optional, so their
 * absence is reported as information rather than as a failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RESET = '[0m';
const DIM = '[2m';
const RED = '[31m';
const YELLOW = '[33m';
const GREEN = '[32m';

let failures = 0;

function line(status, label, detail) {
  const mark =
    status === 'ok'
      ? `${GREEN}ok  ${RESET}`
      : status === 'warn'
        ? `${YELLOW}warn${RESET}`
        : `${RED}fail${RESET}`;
  if (status === 'fail') failures += 1;
  console.log(`  [${mark}] ${label.padEnd(26)} ${DIM}${detail}${RESET}`);
}

function which(command) {
  try {
    return execFileSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function version(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      .trim();
  } catch {
    return undefined;
  }
}

console.log('\nSairiOS environment check\n');

console.log(' Host');
line('ok', 'platform', `${platform()} ${arch()}`);
line(
  totalmem() >= 4 * 1024 ** 3 ? 'ok' : 'warn',
  'memory',
  `${Math.round(totalmem() / 1024 ** 3)} GB (a VM guest wants 4 GB free)`,
);

console.log('\n Required for make dev');
const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeMinor = Number(process.versions.node.split('.')[1]);
const nodeOk = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);
line(
  nodeOk ? 'ok' : 'fail',
  'node',
  nodeOk
    ? `v${process.versions.node}`
    : `v${process.versions.node} — SairiOS needs >= 22.5 (node:sqlite). Install Node 22 LTS.`,
);

const npmVersion = version('npm', ['--version']);
line(npmVersion ? 'ok' : 'fail', 'npm', npmVersion ? `v${npmVersion}` : 'not found');

const installed = existsSync(resolve(ROOT, 'node_modules'));
line(
  installed ? 'ok' : 'fail',
  'dependencies',
  installed ? 'node_modules present' : 'run `make setup`',
);

// node:sqlite is experimental and absent from module.builtinModules, so probe it.
let sqliteDetail = 'unavailable — the JSON store will be used instead';
let sqliteStatus = 'warn';
try {
  const { createRequire } = await import('node:module');
  createRequire(import.meta.url)('node:sqlite');
  sqliteStatus = 'ok';
  sqliteDetail = 'node:sqlite available';
} catch {
  /* reported below */
}
line(sqliteStatus, 'sqlite', sqliteDetail);

console.log('\n Configuration');
const envFile = resolve(ROOT, '.env');
line(
  existsSync(envFile) ? 'ok' : 'warn',
  '.env',
  existsSync(envFile) ? 'present' : 'absent — mock mode defaults apply, which is fine',
);

const provider = process.env.SAIRIOS_AGENT_PROVIDER ?? 'mock';
if (provider === 'mock') {
  line('ok', 'agent provider', 'mock — no API key required, works offline');
} else {
  line(
    process.env.OPENCLAW_GATEWAY_TOKEN ? 'warn' : 'fail',
    'agent provider',
    process.env.OPENCLAW_GATEWAY_TOKEN
      ? 'openclaw — SCAFFOLDING, the gateway protocol is unverified (docs/OPENCLAW.md)'
      : 'openclaw selected but OPENCLAW_GATEWAY_TOKEN is empty',
  );
}

const pinFile = resolve(ROOT, 'openclaw/config/version.json');
if (existsSync(pinFile)) {
  try {
    const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
    line(
      'ok',
      'openclaw pin',
      `${pin.openclaw?.version ?? 'unset'} (${pin.openclaw?.status ?? 'unknown'})`,
    );
  } catch {
    line('warn', 'openclaw pin', 'version.json is unreadable');
  }
}

console.log('\n Optional — VM integration testing (QEMU)');
const hostArch = arch() === 'arm64' ? 'aarch64' : 'x86_64';
const qemu = which(`qemu-system-${hostArch}`);
line(
  qemu ? 'ok' : 'warn',
  `qemu-system-${hostArch}`,
  qemu
    ? (version(`qemu-system-${hostArch}`, ['--version']) ?? qemu)
    : platform() === 'darwin'
      ? 'not installed — `brew install qemu` (needed only for make vm-run)'
      : 'not installed — `sudo apt install qemu-system` (needed only for make vm-run)',
);

if (platform() === 'darwin') {
  line('ok', 'acceleration', 'HVF available on macOS for a same-architecture guest');
} else if (platform() === 'linux') {
  line(
    existsSync('/dev/kvm') ? 'ok' : 'warn',
    'acceleration',
    existsSync('/dev/kvm')
      ? '/dev/kvm present'
      : 'no /dev/kvm — the VM will fall back to slow TCG emulation',
  );
}

const iso =
  which('xorriso') ??
  which('genisoimage') ??
  which('mkisofs') ??
  (platform() === 'darwin' ? which('hdiutil') : undefined);
line(
  iso ? 'ok' : 'warn',
  'ISO builder',
  iso ? iso : 'none found — needed to build the cloud-init seed (xorriso, genisoimage or hdiutil)',
);

console.log('\n Optional — service development (Docker)');
const docker = which('docker');
line(
  docker ? 'ok' : 'warn',
  'docker',
  docker
    ? (version('docker', ['--version']) ?? docker)
    : 'not installed — needed only for containers/compose.yaml, not for make dev',
);

console.log('\n Summary');
if (failures === 0) {
  console.log(
    `  ${GREEN}Ready.${RESET} Run ${DIM}make dev${RESET} to start SairiOS in mock mode.\n`,
  );
} else {
  console.log(
    `  ${RED}${failures} required check(s) failed.${RESET} Fix them, then re-run make doctor.\n`,
  );
}

process.exit(failures === 0 ? 0 : 1);
