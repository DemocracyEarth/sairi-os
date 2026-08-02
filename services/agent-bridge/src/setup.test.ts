import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderSetup, providerCatalogue, PROVIDERS } from './setup.js';

/**
 * Provider setup holds the only real secret in the system, so the tests are
 * mostly about where that secret does NOT end up.
 *
 * The key used throughout is a syntactically valid but entirely fictional string.
 * Nothing here contacts a provider.
 */

const FAKE_KEY = `sk-ant-${'0'.repeat(40)}`;
const MODEL = 'anthropic/claude-opus-5';

let dir: string;
let logs: { level: string; message: string; meta?: unknown }[];

function logger() {
  const record = (level: string) => (message: string, meta?: unknown) =>
    void logs.push({ level, message, meta });
  return {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
  };
}

/** Stands in for the openclaw binary. Records what it was given. */
function fakeOpenclaw() {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const run = vi.fn(async (args: string[], env: NodeJS.ProcessEnv) => {
    calls.push({ args, env });
    return { stdout: '2026.7.1-2\n', stderr: '' };
  });
  return { run, calls };
}

function make(over: Partial<Parameters<typeof ProviderSetup.prototype.constructor>[0]> = {}) {
  const claw = fakeOpenclaw();
  const setup = new ProviderSetup({
    envFilePath: join(dir, 'provider.env'),
    statePath: join(dir, 'provider.json'),
    gatewayUrl: 'ws://127.0.0.1:18789',
    logger: logger(),
    runOpenclaw: claw.run,
    ...over,
  });
  return { setup, claw };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sairios-setup-'));
  logs = [];
});

afterEach(() => void vi.restoreAllMocks());

describe('before anything is configured', () => {
  it('reports not configured without inventing a provider', async () => {
    const { setup } = make();
    const status = await setup.status();
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.keyPresent).toBe(false);
  });

  it('notices when openclaw is absent instead of failing later', async () => {
    const { setup } = make({
      runOpenclaw: async () => {
        throw new Error('spawn openclaw ENOENT');
      },
    });
    expect((await setup.status()).openclawInstalled).toBe(false);
  });
});

describe('configuring a provider', () => {
  it('records the choice and reports configured', async () => {
    const { setup } = make();
    const result = await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });
    expect(result.ok).toBe(true);
    const status = await setup.status();
    expect(status).toMatchObject({ configured: true, provider: 'anthropic', model: MODEL });
  });

  it('onboards openclaw in ref mode, so openclaw stores a pointer and not the key', async () => {
    const { setup, claw } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });

    const onboard = claw.calls.find((c) => c.args[0] === 'onboard');
    expect(onboard).toBeDefined();
    expect(onboard!.args).toContain('--secret-input-mode');
    expect(onboard!.args[onboard!.args.indexOf('--secret-input-mode') + 1]).toBe('ref');
    // Loopback binding is not optional: the gateway must not be reachable off-box.
    expect(onboard!.args).toContain('--gateway-bind');
    expect(onboard!.args[onboard!.args.indexOf('--gateway-bind') + 1]).toBe('loopback');
  });

  it('passes the key through the environment and never through argv', async () => {
    const { setup, claw } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });

    const onboard = claw.calls.find((c) => c.args[0] === 'onboard')!;
    // argv is readable by every user on the machine through `ps`.
    expect(onboard.args.join(' ')).not.toContain(FAKE_KEY);
    expect(onboard.env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY);
  });

  it('writes the credential file 0600 and nothing looser', async () => {
    const { setup } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });

    const info = await stat(join(dir, 'provider.env'));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('writes the key to the credential file and to no other file', async () => {
    const { setup } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });

    expect(await readFile(join(dir, 'provider.env'), 'utf8')).toContain(FAKE_KEY);
    // The state file records the choice, not the secret.
    expect(await readFile(join(dir, 'provider.json'), 'utf8')).not.toContain(FAKE_KEY);
  });
});

describe('what the key must never touch', () => {
  it('is absent from every log line', async () => {
    const { setup } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });
    expect(JSON.stringify(logs)).not.toContain(FAKE_KEY);
  });

  it('is absent from the status object, which is what the UI receives', async () => {
    const { setup } = make();
    await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });

    const status = await setup.status();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(FAKE_KEY);
    // Not even a prefix: a partial key is still key material.
    expect(serialized).not.toContain(FAKE_KEY.slice(0, 12));
    expect(status.keyPresent).toBe(true);
  });

  it('is absent from an onboarding failure message', async () => {
    // A child process that echoes its environment into an error is the case
    // that would leak. The message is what reaches the user's screen.
    const { setup } = make({
      runOpenclaw: async (args: string[], env: NodeJS.ProcessEnv) => {
        if (args[0] === '--version') return { stdout: '2026.7.1-2', stderr: '' };
        throw new Error(`onboarding blew up with env ${JSON.stringify(env)}`);
      },
    });
    const result = await setup.configure({
      provider: 'anthropic',
      model: MODEL,
      apiKey: FAKE_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain(FAKE_KEY);
  });
});

describe('refusing bad input before touching the filesystem', () => {
  const cases: { name: string; input: Record<string, unknown>; code: string }[] = [
    {
      name: 'unknown provider',
      input: { provider: 'acme', model: MODEL, apiKey: FAKE_KEY },
      code: 'unknown_provider',
    },
    { name: 'missing provider', input: { model: MODEL, apiKey: FAKE_KEY }, code: 'invalid_input' },
    {
      name: 'a model belonging to another provider',
      input: { provider: 'anthropic', model: 'openai/gpt-5', apiKey: FAKE_KEY },
      code: 'unknown_model',
    },
    {
      name: 'an arbitrary model string',
      input: { provider: 'anthropic', model: '../../etc/passwd', apiKey: FAKE_KEY },
      code: 'unknown_model',
    },
    {
      name: 'an empty key',
      input: { provider: 'anthropic', model: MODEL, apiKey: '   ' },
      code: 'invalid_input',
    },
    {
      name: 'a key with a newline in it',
      input: { provider: 'anthropic', model: MODEL, apiKey: `${FAKE_KEY}\nEVIL=1` },
      code: 'invalid_input',
    },
    {
      name: 'an absurdly long key',
      input: { provider: 'anthropic', model: MODEL, apiKey: `sk-ant-${'a'.repeat(9000)}` },
      code: 'invalid_input',
    },
    {
      name: 'something that is not a key at all',
      input: { provider: 'anthropic', model: MODEL, apiKey: 'hunter2' },
      code: 'invalid_key_format',
    },
    {
      name: 'a non-string key',
      input: { provider: 'anthropic', model: MODEL, apiKey: 42 },
      code: 'invalid_input',
    },
  ];

  for (const { name, input, code } of cases) {
    it(`rejects ${name}`, async () => {
      const { setup, claw } = make();
      const result = await setup.configure(input as never);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(code);
      // Nothing was written and nothing was onboarded.
      expect(claw.calls.some((c) => c.args[0] === 'onboard')).toBe(false);
      await expect(stat(join(dir, 'provider.env'))).rejects.toThrow();
    });
  }

  it('cannot be used to inject a second variable into the env file', async () => {
    // The env file is parsed line by line by systemd. A key carrying a newline
    // would otherwise define arbitrary variables for the gateway process.
    const { setup } = make();
    await setup.configure({
      provider: 'anthropic',
      model: MODEL,
      apiKey: `${FAKE_KEY}\nLD_PRELOAD=/tmp/evil.so`,
    });
    await expect(stat(join(dir, 'provider.env'))).rejects.toThrow();
  });

  it('refuses when openclaw is not installed rather than saving a key for nothing', async () => {
    const { setup } = make({
      runOpenclaw: async () => {
        throw new Error('ENOENT');
      },
    });
    const result = await setup.configure({ provider: 'anthropic', model: MODEL, apiKey: FAKE_KEY });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('openclaw_missing');
    await expect(stat(join(dir, 'provider.env'))).rejects.toThrow();
  });
});

describe('recovering from a damaged state file', () => {
  it('treats unparseable state as not configured instead of crashing', async () => {
    await writeFile(join(dir, 'provider.json'), '{ this is not json', 'utf8');
    const { setup } = make();
    expect((await setup.status()).configured).toBe(false);
  });
});

describe('the catalogue the UI is given', () => {
  it('carries no key patterns or env var names, only what a person needs to choose', () => {
    const catalogue = providerCatalogue();
    expect(catalogue.length).toBe(PROVIDERS.length);
    for (const entry of catalogue) {
      expect(entry).not.toHaveProperty('keyPattern');
      expect(entry).not.toHaveProperty('envVar');
      expect(entry).not.toHaveProperty('authChoice');
      expect(entry.models.length).toBeGreaterThan(0);
    }
  });

  it('gives every provider a distinct env var, so two providers cannot collide', () => {
    const vars = new Set(PROVIDERS.map((p) => p.envVar));
    expect(vars.size).toBe(PROVIDERS.length);
  });
});
