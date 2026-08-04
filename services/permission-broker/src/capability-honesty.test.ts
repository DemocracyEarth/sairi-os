import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type Capability } from '@sairios/context-schema';
import { readEnv } from '@sairios/shared/node';
import { executeAction } from './actions.js';
import { CAPABILITY_DESCRIPTORS, DEFAULT_POLICIES } from './policy.js';
import { Sandbox } from './sandbox.js';

/**
 * Capability honesty.
 *
 * SairiOS makes one promise about capabilities above all others: **a user always
 * knows whether something really happened**. Two separate places encode that
 * promise, at two different moments:
 *
 *   before  `CAPABILITY_DESCRIPTORS[cap].realSideEffect` — shown while deciding
 *   after   `outcome.simulated` from actions.ts — shown once it has run
 *
 * They are the same claim. If they disagree, the approval prompt misdescribes
 * what is about to happen, which is the one failure this system cannot tolerate.
 *
 * They DID disagree. `system.settings.read` returns real configuration while its
 * descriptor said `realSideEffect: false`, because the field name reads as "does
 * this write something" and a read does not. Nothing checked, so it survived —
 * and put the wrong capability count into three documents, twice under the
 * heading of correcting it.
 *
 * ---------------------------------------------------------------------------
 * Why this goes through executeAction and not through the broker
 * ---------------------------------------------------------------------------
 * `propose()` applies policy immediately, so a capability defaulting to `allow`
 * or `deny` is never `pending` and cannot be decided, and a `deny` one can never
 * reach an outcome at all. Driving the full broker would therefore leave the
 * three denied capabilities untested — and worse, an untested one would pass
 * VACUOUSLY, because "refused" reads as "not real".
 *
 * The question here is not what policy permits; that is covered thoroughly in
 * broker.test.ts. It is whether a capability's outcome tells the truth about
 * itself. `executeAction` is where `simulated` is set, so that is what is
 * compared, and every capability is reached.
 */

const CONTEXT = 'ctx_0123456789abcdef0123456789abcdef';

async function makeContext(): Promise<{
  contextId: string;
  sandbox: Sandbox;
  env: ReturnType<typeof readEnv>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'sairios-honesty-'));
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
  return { contextId: CONTEXT, sandbox: new Sandbox({ root: env.sandboxDir }), env };
}

/**
 * Payloads that let each capability reach its outcome rather than bounce off
 * validation. The keys are the ones actions.ts actually reads — getting these
 * wrong produced an `invalid_payload` that looked exactly like a refusal, which
 * is the second way this test could have passed while proving nothing.
 */
const PAYLOAD: Partial<Record<Capability, unknown>> = {
  'files.read': { path: 'note.txt' },
  'files.write': { path: 'note.txt', content: 'hello' },
  'files.delete': { path: 'note.txt' },
  'network.fetch': { url: 'https://example.org/' },
  'browser.open': { url: 'https://example.org/' },
  'clipboard.write': { content: 'hello' },
  'notifications.send': { message: 'hello' },
};

describe('every capability describes itself the same way twice', () => {
  it('has a descriptor for each declared capability, and no extras', () => {
    expect(Object.keys(CAPABILITY_DESCRIPTORS).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('has a default policy for each declared capability', () => {
    expect(Object.keys(DEFAULT_POLICIES).sort()).toEqual([...CAPABILITIES].sort());
  });

  for (const capability of CAPABILITIES) {
    it(`${capability}: the approval prompt and the outcome agree`, async () => {
      const ctx = await makeContext();

      // Read and delete need something to act on, or they fail for lack of a
      // file and the disagreement would be invisible.
      if (capability === 'files.read' || capability === 'files.delete') {
        await executeAction('files.write', PAYLOAD['files.write'], ctx);
      }

      const result = await executeAction(capability, PAYLOAD[capability] ?? {}, ctx);
      const descriptor = CAPABILITY_DESCRIPTORS[capability];

      if (!result.ok) {
        // The only capability that legitimately produces no outcome is
        // process.execute, which is unimplemented by design. Anything else
        // failing here means the payload above is wrong and this test is
        // measuring nothing.
        expect(capability, `${capability} produced no outcome: ${result.error.message}`).toBe(
          'process.execute',
        );
        expect(descriptor.realSideEffect).toBe(false);
        return;
      }

      expect(
        descriptor.realSideEffect,
        `${capability}: the descriptor says realSideEffect=${descriptor.realSideEffect} but the ` +
          `outcome reports simulated=${result.value.simulated}. One of them is lying to the user.`,
      ).toBe(!result.value.simulated);
    });
  }
});

describe('the capability arithmetic', () => {
  /**
   * Pinned because this count has been misreported three times in
   * documentation. Anyone quoting a number should read it from here rather than
   * counting greps — the greps are what got it wrong, because `realSideEffect`
   * in policy.ts and `simulated` in actions.ts give different totals when they
   * disagree.
   */
  it('is four real, six simulated, one unimplemented', async () => {
    let real = 0;
    let simulated = 0;
    let unimplemented = 0;

    for (const capability of CAPABILITIES) {
      const ctx = await makeContext();
      if (capability === 'files.read' || capability === 'files.delete') {
        await executeAction('files.write', PAYLOAD['files.write'], ctx);
      }
      const result = await executeAction(capability, PAYLOAD[capability] ?? {}, ctx);
      if (!result.ok) unimplemented += 1;
      else if (result.value.simulated) simulated += 1;
      else real += 1;
    }

    expect({ real, simulated, unimplemented, total: CAPABILITIES.length }).toEqual({
      real: 4,
      simulated: 6,
      unimplemented: 1,
      total: 11,
    });
  });

  it('names the four that do something real', () => {
    const real = CAPABILITIES.filter((c) => CAPABILITY_DESCRIPTORS[c].realSideEffect);
    expect([...real].sort()).toEqual([
      'files.delete',
      'files.read',
      'files.write',
      'system.settings.read',
    ]);
  });
});
