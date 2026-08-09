import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEnv } from '@sairios/shared/node';
import { FileAuditLog } from './audit.js';
import { PermissionBroker } from './broker.js';

/**
 * Withdrawing a remembered grant.
 *
 * Until this existed, "allow for this context" was permanent: nothing cleared
 * it when the context was archived and there was no endpoint to take it back.
 * SECURITY.md names revocation as a precondition for remote access, on the
 * reasoning that a grant made from a laptop that is now somewhere else has to
 * be withdrawable from somewhere else too.
 */

const CTX_A = 'ctx_1111111111111111111111111111aaaa'.slice(0, 36);
const CTX_B = 'ctx_2222222222222222222222222222bbbb'.slice(0, 36);

async function makeBroker(): Promise<PermissionBroker> {
  const dir = await mkdtemp(join(tmpdir(), 'sairios-revoke-'));
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
  return new PermissionBroker({
    env,
    audit: new FileAuditLog(join(dir, 'audit.log')),
    policyFile: join(dir, 'policies.json'),
  });
}

/** Grants `capability` in `contextId`, remembered. */
async function grant(
  broker: PermissionBroker,
  contextId: string,
  capability: string,
  options: { global?: boolean; decision?: 'allow' | 'deny' } = {},
): Promise<void> {
  const proposed = await broker.propose({
    contextId,
    capability,
    reason: 'test',
    payload: { path: 'a.txt', content: 'x' },
  });
  if (!proposed.ok) throw new Error(proposed.error.message);
  await broker.decide(proposed.value.id, {
    decision: options.decision ?? 'allow',
    scope: 'context',
    remember: true,
    ...(options.global ? { global: true } : {}),
  });
}

let broker: PermissionBroker;
beforeEach(async () => {
  broker = await makeBroker();
});

describe('revoke', () => {
  it('removes a remembered grant so the next proposal asks again', async () => {
    await grant(broker, CTX_A, 'files.write');
    expect(broker.policySnapshot().remembered).toHaveLength(1);

    const proposedWhileGranted = await broker.propose({
      contextId: CTX_A,
      capability: 'files.write',
      reason: 'test',
      payload: {},
    });
    expect(proposedWhileGranted.ok && proposedWhileGranted.value.status).toBe('allowed');

    await broker.revoke({ capability: 'files.write', contextId: CTX_A });

    const after = await broker.propose({
      contextId: CTX_A,
      capability: 'files.write',
      reason: 'test',
      payload: {},
    });
    // Back to asking. This is the whole point: the grant is gone, not shadowed.
    expect(after.ok && after.value.status).toBe('pending');
  });

  it('leaves other contexts alone', async () => {
    await grant(broker, CTX_A, 'files.write');
    await grant(broker, CTX_B, 'files.write');

    await broker.revoke({ capability: 'files.write', contextId: CTX_A });

    const left = broker.policySnapshot().remembered;
    expect(left).toHaveLength(1);
    expect(left[0]?.contextId).toBe(CTX_B);
  });

  it('withdraws a remembered DENY as well as an allow', async () => {
    // Revocation means "forget this decision", not "make it permissive". A
    // remembered deny is just as stuck as a remembered allow.
    await grant(broker, CTX_A, 'files.write', { decision: 'deny' });
    expect(broker.policySnapshot().remembered).toHaveLength(1);
    await broker.revoke({ capability: 'files.write', contextId: CTX_A });
    expect(broker.policySnapshot().remembered).toHaveLength(0);
  });

  it('addresses a global grant with contextId null', async () => {
    await grant(broker, CTX_A, 'files.write', { global: true });
    expect(broker.policySnapshot().remembered[0]?.contextId).toBeNull();

    // `null` is meaningful, not missing: it is how a global grant is named.
    const result = await broker.revoke({ capability: 'files.write', contextId: null });
    expect(result.ok && result.value.revoked).toHaveLength(1);
    expect(broker.policySnapshot().remembered).toHaveLength(0);
  });

  it('refuses to guess when given no filter at all', async () => {
    await grant(broker, CTX_A, 'files.write');
    const result = await broker.revoke({});
    expect(result.ok).toBe(false);
    // Nothing removed: an accidentally-empty argument must not clear the table.
    expect(broker.policySnapshot().remembered).toHaveLength(1);
  });

  it('clears everything only when explicitly told to', async () => {
    await grant(broker, CTX_A, 'files.write');
    await grant(broker, CTX_B, 'files.read');
    const result = await broker.revoke({ all: true });
    expect(result.ok && result.value.revoked).toHaveLength(2);
    expect(broker.policySnapshot().remembered).toHaveLength(0);
  });

  it('rejects a capability it does not know', async () => {
    const result = await broker.revoke({ capability: 'files.obliterate' as never });
    expect(result.ok).toBe(false);
  });

  it('is a no-op, not an error, when nothing matches', async () => {
    const result = await broker.revoke({ capability: 'files.write', contextId: CTX_A });
    expect(result.ok && result.value.revoked).toEqual([]);
  });

  it('survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-revoke-restart-'));
    const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
    const policyFile = join(dir, 'policies.json');
    const options = { env, audit: new FileAuditLog(join(dir, 'audit.log')), policyFile };

    const first = new PermissionBroker(options);
    await grant(first, CTX_A, 'files.write');
    await first.revoke({ capability: 'files.write', contextId: CTX_A });

    // A revocation that only lived in memory would come back on reboot, which
    // is the worst possible moment to rediscover a grant you withdrew.
    const second = new PermissionBroker(options);
    await second.load();
    expect(second.policySnapshot().remembered).toHaveLength(0);
    expect(JSON.parse(await readFile(policyFile, 'utf8'))).toEqual([]);
  });

  it('stops a request the revoked grant had already allowed', async () => {
    // The in-flight case. propose() auto-allows from the remembered grant, then
    // the grant is revoked before execute() runs. Revocation leaves the policy
    // at `ask` rather than `deny`, so a check that only looked for `deny` let
    // this run on an authorisation that no longer existed.
    await grant(broker, CTX_A, 'files.write');
    const inFlight = await broker.propose({
      contextId: CTX_A,
      capability: 'files.write',
      reason: 'test',
      payload: { path: 'a.txt', content: 'x' },
    });
    expect(inFlight.ok && inFlight.value.status).toBe('allowed');

    await broker.revoke({ capability: 'files.write', contextId: CTX_A });

    const executed = await broker.execute((inFlight as { value: { id: string } }).value.id);
    expect(executed.ok).toBe(false);
    if (!executed.ok) expect(executed.error.code).toBe('grant_revoked');
  });

  it('does not cancel an explicit allow-once when a standing grant is revoked', async () => {
    // Withdrawing a standing grant is not the same as taking back the decision
    // a human made about one specific request.
    const proposed = await broker.propose({
      contextId: CTX_B,
      capability: 'files.write',
      reason: 'test',
      payload: { path: 'b.txt', content: 'y' },
    });
    if (!proposed.ok) throw new Error('propose failed');
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });

    await broker.revoke({ all: true });

    const executed = await broker.execute(proposed.value.id);
    expect(executed.ok && executed.value.status).toBe('executed');
  });

  it('writes a revocation to the audit log', async () => {
    // A log that records every grant and no withdrawal reads as though
    // permissions only ever widened.
    await grant(broker, CTX_A, 'files.write');
    await broker.revoke({ capability: 'files.write', contextId: CTX_A });

    const records = await broker.auditRecent(50);
    const revoked = records.filter((r) => r.phase === 'revoked');
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.capability).toBe('files.write');
    expect(revoked[0]?.summary).toContain('Revoked');
  });
});
