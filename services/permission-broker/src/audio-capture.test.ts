import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEnv } from '@sairios/shared/node';
import { executeAction } from './actions.js';
import { CAPABILITY_DESCRIPTORS, DEFAULT_POLICIES } from './policy.js';
import { Sandbox } from './sandbox.js';

/**
 * `audio.capture`, and the one property that makes it defensible.
 *
 * The broker authorises this capability without performing it, because a
 * microphone belongs to the machine running the browser — over a tunnel, the
 * user's laptop rather than the guest. That is a weaker form of enforcement
 * than the other capabilities get, and the compensating property is privacy:
 * capture and transcription both happen in the page, so **no audio and no
 * transcript ever reach SairiOS**.
 *
 * A property that holds only because nobody has added a field yet is not a
 * property. So most of this file asserts absence: that speech cannot be sent
 * here even by a caller who tries.
 */

async function context(): Promise<Parameters<typeof executeAction>[2]> {
  const dir = await mkdtemp(join(tmpdir(), 'sairios-audio-'));
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
  return {
    contextId: 'ctx_0123456789abcdef0123456789abcdef',
    sandbox: new Sandbox({ root: env.sandboxDir }),
    env,
  };
}

describe('audio.capture', () => {
  it('is never allowed by default', () => {
    expect(DEFAULT_POLICIES['audio.capture']).toBe('ask');
  });

  it('is rated high risk', () => {
    // It records people who are not users of this machine, which no other
    // capability does. `clipboard.read` is denied outright for a weaker reason.
    expect(CAPABILITY_DESCRIPTORS['audio.capture'].risk).toBe('high');
  });

  it('reports itself as real rather than simulated', async () => {
    const result = await executeAction('audio.capture', { purpose: 'dictate' }, await context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A microphone really opens. Saying "simulated" would tell the user nothing
    // happened while their recording indicator is lit.
    expect(result.value.simulated).toBe(false);
    expect(CAPABILITY_DESCRIPTORS['audio.capture'].realSideEffect).toBe(!result.value.simulated);
  });

  it('requires a purpose, so an approval prompt can never be blank', async () => {
    const result = await executeAction('audio.capture', {}, await context());
    expect(result.ok).toBe(false);
  });

  it('does not accept audio, and does not echo it if sent', async () => {
    // The hostile caller: a future shell change, or a compromised page, posting
    // speech to the broker "for the audit log". There is no field for it, and
    // the outcome must not carry it back out either.
    const result = await executeAction(
      'audio.capture',
      {
        purpose: 'dictate',
        audio: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEA',
        transcript: 'my bank password is hunter2',
        samples: [1, 2, 3],
        text: 'transfer the money',
      },
      await context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blob = JSON.stringify(result.value);
    expect(blob).not.toContain('hunter2');
    expect(blob).not.toContain('transfer the money');
    expect(blob).not.toContain('UklGRiQ');
    expect(blob).not.toContain('samples');
  });

  it('carries only the purpose out of the payload', async () => {
    const result = await executeAction(
      'audio.capture',
      { purpose: 'dictate an intention', transcript: 'leak me' },
      await context(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.detail).toEqual({
      purpose: 'dictate an intention',
      note: 'Captured and transcribed in the browser. SairiOS received no audio and no transcript.',
    });
  });

  it('bounds the purpose, so it cannot become a smuggling channel', async () => {
    // Without a length cap, `purpose` is a free-text field the outcome echoes —
    // which is exactly the shape of the thing the test above forbids.
    const result = await executeAction(
      'audio.capture',
      { purpose: 'x'.repeat(5000) },
      await context(),
    );
    expect(result.ok).toBe(false);
  });
});
