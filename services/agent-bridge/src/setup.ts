import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { fail, ok, type Logger, type Result } from '@sairios/shared';

/**
 * Provider setup: how a real model gets attached to SairiOS.
 *
 * The rule the rest of this project states everywhere — SairiOS never
 * authenticates to a model provider — still holds, and this is the module that
 * makes it true rather than aspirational. What happens when a user supplies a key:
 *
 *   1. The key is written to ONE file, mode 0600, owned by the account the
 *      services run as. It is never returned by any endpoint, never logged, never
 *      placed in a context, and never carried into a crystallized template.
 *   2. OpenClaw is onboarded with `--secret-input-mode ref`, which stores an
 *      env-backed REFERENCE — `{ source: "env", id: "ANTHROPIC_API_KEY" }` — in
 *      its auth profile rather than the secret itself.
 *   3. The key reaches OpenClaw through the child process environment, never as
 *      a command-line argument, because argv is world-readable through `ps`.
 *
 * So the secret exists in exactly two places: the 0600 file, and the memory of
 * the process that needs it. Not in OpenClaw's config, not in ours, not in an
 * image layer, not in a log.
 */

const execFileAsync = promisify(execFile);

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  /** Environment variable OpenClaw resolves the credential from. */
  envVar: string;
  /** `--auth-choice` value for `openclaw onboard`. */
  authChoice: string;
  /** Human hint shown next to the key field. Never a real key. */
  keyHint: string;
  /** Cheap shape check. Deliberately loose: providers change key formats. */
  keyPattern: RegExp;
  models: ProviderModel[];
  docsUrl: string;
}

/**
 * The providers SairiOS can configure today.
 *
 * Only these two are listed because these are the two whose `--auth-choice`
 * values are documented in OpenClaw's own CLI automation reference. Adding a
 * provider means checking its flag there, not guessing: a wrong value fails
 * deep inside onboarding with an unhelpful message.
 */
export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    authChoice: 'apiKey',
    keyHint: 'sk-ant-…',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    authChoice: 'openai-api-key',
    keyHint: 'sk-…',
    keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'openai/gpt-5', label: 'GPT-5' }],
  },
];

export function findProvider(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Keys are bounded so a malformed paste cannot become a large file write. */
const MAX_KEY_LENGTH = 512;

export interface SetupStatus {
  /** True once a provider has been configured on this machine. */
  configured: boolean;
  provider: string | null;
  model: string | null;
  /** Whether the `openclaw` binary is present. */
  openclawInstalled: boolean;
  openclawVersion: string | null;
  gatewayUrl: string;
  /**
   * Never contains the key. The UI shows "configured" or "not configured" and
   * has no way to read a key back, because there is no reason for it to.
   */
  keyPresent: boolean;
}

export interface SetupDeps {
  /** 0600 file the provider credential is written to. */
  envFilePath: string;
  /** Records the chosen provider and model. Contains no secret. */
  statePath: string;
  gatewayUrl: string;
  logger: Logger;
  /** Injectable so tests never spawn anything. */
  runOpenclaw?: (
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<{ stdout: string; stderr: string }>;
  openclawBin?: string;
}

interface SetupState {
  provider: string;
  model: string;
  configuredAt: string;
}

export class ProviderSetup {
  readonly #deps: SetupDeps;
  readonly #bin: string;

  constructor(deps: SetupDeps) {
    this.#deps = deps;
    this.#bin = deps.openclawBin ?? 'openclaw';
  }

  async status(): Promise<SetupStatus> {
    const state = await this.#readState();
    const version = await this.#openclawVersion();
    return {
      configured: state !== undefined,
      provider: state?.provider ?? null,
      model: state?.model ?? null,
      openclawInstalled: version !== null,
      openclawVersion: version,
      gatewayUrl: this.#deps.gatewayUrl,
      keyPresent: await this.#keyPresent(),
    };
  }

  /**
   * Configures a provider. The only entry point that ever sees a key.
   *
   * Validation is strict and happens before anything is written: an unknown
   * provider, a model that is not one of that provider's, or a key that does not
   * look like a key are all rejected without touching the filesystem.
   */
  async configure(input: {
    provider: unknown;
    model: unknown;
    apiKey: unknown;
  }): Promise<Result<SetupStatus>> {
    if (typeof input.provider !== 'string') return fail('invalid_input', 'A provider is required.');
    const provider = findProvider(input.provider);
    if (!provider) {
      return fail(
        'unknown_provider',
        `"${input.provider}" is not a provider SairiOS can configure.`,
      );
    }

    if (typeof input.model !== 'string' || !provider.models.some((m) => m.id === input.model)) {
      return fail('unknown_model', `"${String(input.model)}" is not a ${provider.label} model.`);
    }

    if (typeof input.apiKey !== 'string') return fail('invalid_input', 'An API key is required.');
    const apiKey = input.apiKey.trim();
    if (apiKey.length === 0) return fail('invalid_input', 'The API key is empty.');
    if (apiKey.length > MAX_KEY_LENGTH) {
      return fail('invalid_input', `The API key is longer than ${MAX_KEY_LENGTH} characters.`);
    }
    if (/\s/.test(apiKey)) {
      return fail('invalid_input', 'The API key contains whitespace. Check for a stray newline.');
    }
    if (!provider.keyPattern.test(apiKey)) {
      return fail(
        'invalid_key_format',
        `That does not look like a ${provider.label} key (expected ${provider.keyHint}). ` +
          `Nothing was saved.`,
      );
    }

    if ((await this.#openclawVersion()) === null) {
      return fail(
        'openclaw_missing',
        'OpenClaw is not installed on this machine, so there is nothing to configure. ' +
          'See docs/OPENCLAW.md.',
      );
    }

    // Never log the key, and never log an object that might carry it.
    this.#deps.logger.info('configuring provider', {
      provider: provider.id,
      model: input.model,
    });

    await this.#writeEnvFile(provider, apiKey);

    // `ref` mode: OpenClaw stores {source:"env", id:"<VAR>"}, not the secret. The
    // key travels in the child's environment; it is never in argv, which `ps`
    // exposes to every user on the machine.
    const args = [
      'onboard',
      '--non-interactive',
      '--accept-risk',
      '--mode',
      'local',
      '--auth-choice',
      provider.authChoice,
      '--secret-input-mode',
      'ref',
      '--gateway-bind',
      'loopback',
      '--skip-bootstrap',
      '--skip-skills',
    ];

    try {
      const run = this.#deps.runOpenclaw ?? this.#spawnOpenclaw.bind(this);
      await run(args, { ...process.env, [provider.envVar]: apiKey });
    } catch (cause) {
      // The message may quote our arguments back; it never contains the key,
      // because the key was never an argument.
      const message = cause instanceof Error ? cause.message : String(cause);
      this.#deps.logger.warn('openclaw onboarding failed', { provider: provider.id });
      return fail('onboarding_failed', `OpenClaw onboarding failed: ${message.slice(0, 500)}`);
    }

    await this.#writeState({
      provider: provider.id,
      model: input.model,
      configuredAt: new Date().toISOString(),
    });

    return ok(await this.status());
  }

  async #spawnOpenclaw(args: string[], env: NodeJS.ProcessEnv) {
    return execFileAsync(this.#bin, args, {
      env,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      // No shell. argv is passed as an array, so nothing here is ever parsed by
      // a shell and none of it can be turned into a command by its contents.
      shell: false,
    });
  }

  async #openclawVersion(): Promise<string | null> {
    try {
      const run = this.#deps.runOpenclaw ?? this.#spawnOpenclaw.bind(this);
      const { stdout } = await run(['--version'], process.env);
      return stdout.trim().split('\n')[0] ?? null;
    } catch {
      return null;
    }
  }

  async #writeEnvFile(provider: ProviderSpec, apiKey: string): Promise<void> {
    await mkdir(dirname(this.#deps.envFilePath), { recursive: true, mode: 0o700 });
    // systemd EnvironmentFile syntax. One variable, no export, no quoting: the
    // key is already validated to contain no whitespace.
    const body =
      `# Written by SairiOS provider setup. Mode 0600 on purpose.\n` +
      `# This is the only file on the machine that holds the provider credential.\n` +
      `# OpenClaw stores a reference to this variable, not its value.\n` +
      `${provider.envVar}=${apiKey}\n`;
    await writeFile(this.#deps.envFilePath, body, { encoding: 'utf8', mode: 0o600 });
    // writeFile's mode is subject to umask; chmod is not.
    await chmod(this.#deps.envFilePath, 0o600);
  }

  async #keyPresent(): Promise<boolean> {
    try {
      const body = await readFile(this.#deps.envFilePath, 'utf8');
      return /^[A-Z_]+=.+$/m.test(body);
    } catch {
      return false;
    }
  }

  async #readState(): Promise<SetupState | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#deps.statePath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const state = parsed as SetupState;
      return typeof state.provider === 'string' && typeof state.model === 'string'
        ? state
        : undefined;
    } catch {
      return undefined;
    }
  }

  async #writeState(state: SetupState): Promise<void> {
    await mkdir(dirname(this.#deps.statePath), { recursive: true });
    await writeFile(this.#deps.statePath, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}

/** Provider catalogue for the setup UI. Contains no secrets and no patterns. */
export function providerCatalogue() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    keyHint: p.keyHint,
    docsUrl: p.docsUrl,
    models: p.models,
  }));
}
