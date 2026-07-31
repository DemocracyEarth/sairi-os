import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEnv, type SairiEnv } from '@sairios/shared/node';
import { MemoryAuditLog } from './audit.js';
import { PermissionBroker } from './broker.js';
import { DEFAULT_POLICIES, resolvePolicy, type PolicySnapshot } from './policy.js';
import { Sandbox } from './sandbox.js';

const CONTEXT = 'ctx_0123456789abcdef0123456789abcdef';
const OTHER_CONTEXT = 'ctx_fedcba9876543210fedcba9876543210';

async function makeBroker(): Promise<{
  broker: PermissionBroker;
  audit: MemoryAuditLog;
  env: SairiEnv;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'sairios-broker-'));
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
  const audit = new MemoryAuditLog();
  return { broker: new PermissionBroker({ env, audit }), audit, env };
}

describe('default policy table', () => {
  it('matches the documented defaults exactly', () => {
    expect(DEFAULT_POLICIES).toEqual({
      'files.read': 'ask',
      'files.write': 'ask',
      'files.delete': 'deny',
      'process.list': 'allow',
      'process.execute': 'deny',
      'network.fetch': 'ask',
      'browser.open': 'ask',
      'clipboard.read': 'deny',
      'clipboard.write': 'ask',
      'notifications.send': 'ask',
      'system.settings.read': 'allow',
    });
  });

  it('denies the two highest-risk capabilities by default', () => {
    expect(DEFAULT_POLICIES['process.execute']).toBe('deny');
    expect(DEFAULT_POLICIES['files.delete']).toBe('deny');
  });
});

describe('policy resolution', () => {
  const snapshot = (remembered: PolicySnapshot['remembered']): PolicySnapshot => ({
    defaults: DEFAULT_POLICIES,
    remembered,
  });

  it('falls back to the default when nothing is remembered', () => {
    const result = resolvePolicy('files.read', CONTEXT, snapshot([]));
    expect(result).toEqual({ decision: 'ask', source: 'default' });
  });

  it('prefers a context decision over a global one', () => {
    const result = resolvePolicy(
      'files.read',
      CONTEXT,
      snapshot([
        {
          capability: 'files.read',
          decision: 'deny',
          scope: 'context',
          contextId: CONTEXT,
          decidedAt: 'x',
        },
        {
          capability: 'files.read',
          decision: 'allow',
          scope: 'global',
          contextId: null,
          decidedAt: 'x',
        },
      ]),
    );
    expect(result).toEqual({ decision: 'deny', source: 'context-memory' });
  });

  it('does not apply one context decision to another context', () => {
    const result = resolvePolicy(
      'files.read',
      OTHER_CONTEXT,
      snapshot([
        {
          capability: 'files.read',
          decision: 'allow',
          scope: 'context',
          contextId: CONTEXT,
          decidedAt: 'x',
        },
      ]),
    );
    expect(result.source).toBe('default');
  });
});

describe('three-phase permission flow', () => {
  let broker: PermissionBroker;
  let audit: MemoryAuditLog;

  beforeEach(async () => {
    ({ broker, audit } = await makeBroker());
  });

  it('observation has no side effects and describes the capability', () => {
    const described = broker.describe('files.delete');
    expect(described.ok).toBe(true);
    if (described.ok) {
      expect(described.value.risk).toBe('high');
      expect(described.value.defaultPolicy).toBe('deny');
    }
    expect(audit.all).toHaveLength(0);
  });

  it('refuses to describe a capability outside the known set', () => {
    expect(broker.describe('system.shell').ok).toBe(false);
  });

  it('a proposal never executes, even under an allow policy', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'process.list',
      reason: 'see services',
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    // allow-by-default becomes `allowed`, NOT `executed`.
    expect(proposed.value.status).toBe('allowed');
    expect(proposed.value.outcome).toBeUndefined();
    expect(audit.all.map((r) => r.phase)).toEqual(['auto-allowed']);
  });

  it('a deny-by-default capability is refused at proposal time', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'process.execute',
      reason: 'run a script',
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.value.status).toBe('denied');
    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok).toBe(false);
    if (!executed.ok) expect(executed.error.code).toBe('not_allowed');
  });

  it('an ask capability waits for a human decision', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.write',
      reason: 'save the summary',
      payload: { path: 'summary.md', content: 'hello' },
    });
    if (!proposed.ok) throw new Error('expected success');
    expect(proposed.value.status).toBe('pending');
    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok).toBe(false);
  });

  it('runs an allowed action and records both decision and execution', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.write',
      reason: 'save the summary',
      payload: { path: 'summary.md', content: 'hello' },
    });
    if (!proposed.ok) throw new Error('expected success');

    const decided = await broker.decide(proposed.value.id, {
      decision: 'allow',
      scope: 'once',
      remember: false,
    });
    expect(decided.ok).toBe(true);

    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok).toBe(true);
    if (executed.ok) {
      expect(executed.value.status).toBe('executed');
      expect(executed.value.outcome?.simulated).toBe(false);
    }
    expect(audit.all.map((r) => r.phase)).toEqual(['proposed', 'decided', 'executed']);
  });

  it('cannot decide the same request twice', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'network.fetch',
      reason: 'fetch',
      payload: { url: 'https://example.org' },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    const again = await broker.decide(proposed.value.id, {
      decision: 'allow',
      scope: 'once',
      remember: false,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('not_pending');
  });

  it('"deny and remember" applies to later proposals in the same context', async () => {
    const first = await broker.propose({
      contextId: CONTEXT,
      capability: 'network.fetch',
      reason: 'a',
    });
    if (!first.ok) throw new Error('expected success');
    await broker.decide(first.value.id, { decision: 'deny', scope: 'context', remember: true });

    const second = await broker.propose({
      contextId: CONTEXT,
      capability: 'network.fetch',
      reason: 'b',
    });
    if (!second.ok) throw new Error('expected success');
    expect(second.value.status).toBe('denied');
    expect(second.value.policySource).toBe('context-memory');
  });

  it('"allow for this context" does not leak into another context', async () => {
    const first = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'a',
    });
    if (!first.ok) throw new Error('expected success');
    await broker.decide(first.value.id, { decision: 'allow', scope: 'context', remember: true });

    const elsewhere = await broker.propose({
      contextId: OTHER_CONTEXT,
      capability: 'files.read',
      reason: 'b',
    });
    if (!elsewhere.ok) throw new Error('expected success');
    expect(elsewhere.value.status).toBe('pending');
  });

  it('a deny recorded after approval still blocks execution', async () => {
    const target = await broker.propose({
      contextId: CONTEXT,
      capability: 'browser.open',
      reason: 'a',
    });
    if (!target.ok) throw new Error('expected success');
    await broker.decide(target.value.id, { decision: 'allow', scope: 'once', remember: false });

    // The user changes their mind through a second request before the first ran.
    const later = await broker.propose({
      contextId: CONTEXT,
      capability: 'browser.open',
      reason: 'b',
    });
    if (!later.ok) throw new Error('expected success');
    await broker.decide(later.value.id, { decision: 'deny', scope: 'context', remember: true });

    const executed = await broker.execute(target.value.id);
    expect(executed.ok).toBe(false);
    if (!executed.ok) expect(executed.error.code).toBe('denied_by_policy');
  });

  it('cancels a pending request', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'a',
    });
    if (!proposed.ok) throw new Error('expected success');
    const cancelled = await broker.cancel(proposed.value.id);
    expect(cancelled.ok).toBe(true);
    expect(broker.pending(CONTEXT)).toHaveLength(0);
  });

  it('will not cancel an action that already ran', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'process.list',
      reason: 'a',
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.execute(proposed.value.id);
    const cancelled = await broker.cancel(proposed.value.id);
    expect(cancelled.ok).toBe(false);
  });

  it('refuses a proposal that is not attributable to a context', async () => {
    const proposed = await broker.propose({
      contextId: 'not-a-context',
      capability: 'files.read',
      reason: 'a',
    });
    expect(proposed.ok).toBe(false);
    if (!proposed.ok) expect(proposed.error.code).toBe('invalid_context_id');
  });

  it('refuses a capability outside the known set', async () => {
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'system.shell',
      reason: 'a',
    });
    expect(proposed.ok).toBe(false);
  });
});

describe('capability execution', () => {
  it('refuses process execution even when the request state is tampered with', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'process.execute',
      reason: 'x',
    });
    if (!proposed.ok) throw new Error('expected success');
    // Forge the state an attacker would need. The execution-time policy
    // re-check still refuses, so there are two independent barriers.
    proposed.value.status = 'allowed';
    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok).toBe(false);
    if (!executed.ok) expect(executed.error.code).toBe('denied_by_policy');
  });

  it('reports not_implemented if execution is ever reached for process.execute', async () => {
    const outcome = await import('./actions.js').then((m) =>
      m.executeAction(
        'process.execute',
        {},
        {
          contextId: CONTEXT,
          sandbox: new Sandbox({ root: '/tmp/sairios-unused' }),
          env: readEnv({ SAIRIOS_DATA_DIR: '/tmp/sairios-unused' }),
        },
      ),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('not_implemented');
  });

  it('turns a filesystem failure into a recorded error instead of throwing', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'x',
      payload: { path: 'does/not/exist.md' },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok).toBe(true);
    if (executed.ok) expect(executed.value.status).toBe('failed');
  });

  it('marks simulated capabilities as simulated', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'network.fetch',
      reason: 'x',
      payload: { url: 'https://example.org/a' },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    const executed = await broker.execute(proposed.value.id);
    if (!executed.ok) throw new Error('expected success');
    expect(executed.value.outcome?.simulated).toBe(true);
  });

  it('rejects a non-http url for network.fetch', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'network.fetch',
      reason: 'x',
      payload: { url: 'file:///etc/passwd' },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    const executed = await broker.execute(proposed.value.id);
    if (!executed.ok) throw new Error('expected a recorded failure');
    expect(executed.value.status).toBe('failed');
  });

  it('never leaks host processes through process.list', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'process.list',
      reason: 'x',
    });
    if (!proposed.ok) throw new Error('expected success');
    const executed = await broker.execute(proposed.value.id);
    if (!executed.ok) throw new Error('expected success');
    const detail = executed.value.outcome?.detail as { services: unknown[] };
    expect(detail.services).toHaveLength(3);
    expect(JSON.stringify(detail)).not.toContain('node');
  });

  it('system.settings.read exposes no secrets', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'system.settings.read',
      reason: 'x',
    });
    if (!proposed.ok) throw new Error('expected success');
    const executed = await broker.execute(proposed.value.id);
    if (!executed.ok) throw new Error('expected success');
    const serialized = JSON.stringify(executed.value.outcome?.detail);
    expect(serialized).not.toMatch(/token|apiKey|api_key|password/i);
  });
});

describe('audit log', () => {
  it('attributes every record to a context and a request', async () => {
    const { broker, audit } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'x',
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'deny', scope: 'once', remember: false });
    for (const record of audit.all) {
      expect(record.contextId).toBe(CONTEXT);
      expect(record.requestId).toBe(proposed.value.id);
      expect(record.at).toBeTruthy();
    }
  });

  it('redacts secrets that reach a log detail', async () => {
    const audit = new MemoryAuditLog();
    await audit.append({
      contextId: CONTEXT,
      requestId: 'req_0123456789abcdef0123456789abcdef',
      capability: 'network.fetch',
      phase: 'proposed',
      summary: 'x',
      detail: { apiKey: 'sk-live-9999999999999999', note: 'Bearer abcdefghijklmnop' },
    });
    const serialized = JSON.stringify(audit.all);
    expect(serialized).not.toContain('sk-live-9999999999999999');
    expect(serialized).not.toContain('abcdefghijklmnop');
    expect(serialized).toContain('[redacted]');
  });
});

describe('remembered policy persistence', () => {
  it('reloads remembered decisions from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-policy-'));
    const policyFile = join(dir, 'permission-policies.json');
    const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });

    const first = new PermissionBroker({ env, audit: new MemoryAuditLog(), policyFile });
    const proposed = await first.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'x',
    });
    if (!proposed.ok) throw new Error('expected success');
    await first.decide(proposed.value.id, { decision: 'deny', scope: 'context', remember: true });

    const second = new PermissionBroker({ env, audit: new MemoryAuditLog(), policyFile });
    await second.load();
    const again = await second.propose({
      contextId: CONTEXT,
      capability: 'files.read',
      reason: 'x',
    });
    if (!again.ok) throw new Error('expected success');
    expect(again.value.status).toBe('denied');
  });

  it('falls back to defaults when the policy file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-policy-'));
    const policyFile = join(dir, 'permission-policies.json');
    await writeFile(policyFile, 'not json at all');
    const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
    const broker = new PermissionBroker({ env, audit: new MemoryAuditLog(), policyFile });
    await broker.load();
    expect(broker.policySnapshot().remembered).toHaveLength(0);
  });
});

describe('sandbox containment', () => {
  it('confines writes to the context directory', async () => {
    const { broker, env } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.write',
      reason: 'x',
      payload: { path: 'notes/summary.md', content: 'hello' },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    await broker.execute(proposed.value.id);

    const written = await readFile(join(env.sandboxDir, CONTEXT, 'notes/summary.md'), 'utf8');
    expect(written).toBe('hello');
  });

  it('rejects traversal, absolute paths and null bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-sandbox-'));
    const sandbox = new Sandbox({ root: dir });
    for (const path of ['../escape.txt', '/etc/passwd', 'a/../../b', 'x\0.txt', '..']) {
      const result = await sandbox.resolvePath(CONTEXT, path);
      expect(result.ok, `expected ${JSON.stringify(path)} to be rejected`).toBe(false);
    }
  });

  it('accepts a plain relative path inside the context directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-sandbox-'));
    const sandbox = new Sandbox({ root: dir });
    const result = await sandbox.resolvePath(CONTEXT, 'notes.md');
    expect(result.ok).toBe(true);
    // Compare against the REAL path: on macOS the temp dir is a symlink, and
    // resolvePath deliberately resolves symlinks before checking containment.
    const realRoot = await realpath(dir);
    if (result.ok) expect(result.value.startsWith(realRoot)).toBe(true);
  });

  it('refuses a path for something that is not a context id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-sandbox-'));
    const sandbox = new Sandbox({ root: dir });
    const result = await sandbox.resolvePath('../../etc', 'passwd');
    expect(result.ok).toBe(false);
  });
});

describe('resource limits', () => {
  it('caps how much an agent can write into the sandbox', async () => {
    const { broker } = await makeBroker();
    const proposed = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.write',
      reason: 'fill the disk',
      // One byte over the documented 512 kB cap.
      payload: { path: 'big.txt', content: 'a'.repeat(512 * 1024 + 1) },
    });
    if (!proposed.ok) throw new Error('expected success');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
    const executed = await broker.execute(proposed.value.id);
    if (!executed.ok) throw new Error('expected a recorded failure');
    expect(executed.value.status).toBe('failed');
    expect(executed.value.error?.code).toBe('invalid_payload');
  });

  it('rejects a payload that is not the shape the capability expects', async () => {
    const { broker } = await makeBroker();
    for (const payload of [undefined, {}, { path: 123 }, { path: '' }, 'a string', []]) {
      const proposed = await broker.propose({
        contextId: CONTEXT,
        capability: 'files.read',
        reason: 'x',
        payload,
      });
      if (!proposed.ok) throw new Error('expected success');
      await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
      const executed = await broker.execute(proposed.value.id);
      if (!executed.ok) throw new Error('expected a recorded failure');
      expect(executed.value.status, `payload ${JSON.stringify(payload)}`).toBe('failed');
    }
  });

  it('refuses an over-long path outright', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-sandbox-'));
    const sandbox = new Sandbox({ root: dir });
    const result = await sandbox.resolvePath(CONTEXT, 'a'.repeat(2000));
    expect(result.ok).toBe(false);
  });
});
