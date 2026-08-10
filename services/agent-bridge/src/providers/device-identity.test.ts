import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertDevice,
  canonicalPayload,
  generateDeviceIdentity,
  readDeviceIdentity,
  readGatewayToken,
  type DeviceIdentity,
} from './device-identity.js';

/**
 * The device handshake, pinned.
 *
 * A gateway that rejects a signature says "unauthorized" and nothing else — no
 * field name, no hint about which part of the string was wrong. So the layout
 * has to be asserted here, character by character, or the next person to touch
 * it finds out from a production failure that reads like a credential problem.
 *
 * The layout below was read out of OpenClaw's own client bundle and confirmed
 * against a live gateway in the VM: with it, `connect` returns ok and
 * `sessions.create` succeeds.
 */

const IDENTITY: DeviceIdentity = generateDeviceIdentity();

const BASE = {
  identity: IDENTITY,
  clientId: 'gateway-client',
  clientMode: 'backend',
  role: 'operator',
  scopes: ['operator.read', 'operator.write'],
  nonce: 'a-nonce',
  signedAt: 1_737_264_000_000,
};

describe('canonicalPayload', () => {
  it('is exactly the nine pipe-separated fields, in order', () => {
    expect(canonicalPayload({ ...BASE, token: 'tok' })).toBe(
      [
        'v2',
        IDENTITY.deviceId,
        'gateway-client',
        'backend',
        'operator',
        'operator.read,operator.write',
        '1737264000000',
        'tok',
        'a-nonce',
      ].join('|'),
    );
  });

  it('joins scopes with a comma and no space', () => {
    // `join(', ')` would be the natural thing to write and produces a signature
    // the gateway rejects with no explanation.
    expect(canonicalPayload({ ...BASE, token: 't' })).toContain('|operator.read,operator.write|');
  });

  it('leaves an EMPTY field for a missing token rather than omitting it', () => {
    // The fields are positional. Dropping one shifts the nonce into the token's
    // place and every later field with it.
    const withoutToken = canonicalPayload({ ...BASE, token: undefined });
    expect(withoutToken.split('|')).toHaveLength(9);
    expect(withoutToken).toContain('|1737264000000||a-nonce');
  });

  it('signs the timestamp as a string, not a number', () => {
    expect(canonicalPayload({ ...BASE, token: '' })).toContain('|1737264000000|');
  });
});

describe('assertDevice', () => {
  it('produces a signature the public key actually verifies', () => {
    const assertion = assertDevice({ ...BASE, token: 'tok' });
    const ok = verify(
      null,
      Buffer.from(canonicalPayload({ ...BASE, token: 'tok' }), 'utf8'),
      createPublicKey(IDENTITY.publicKeyPem),
      Buffer.from(assertion.signature, 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('does not verify against a different nonce', () => {
    // The nonce is the whole point of the challenge: a signature that verifies
    // without it is replayable.
    const assertion = assertDevice({ ...BASE, token: 'tok' });
    const ok = verify(
      null,
      Buffer.from(canonicalPayload({ ...BASE, token: 'tok', nonce: 'different' }), 'utf8'),
      createPublicKey(IDENTITY.publicKeyPem),
      Buffer.from(assertion.signature, 'base64'),
    );
    expect(ok).toBe(false);
  });

  it('carries the nonce and timestamp it signed back out', () => {
    // The gateway re-derives the string from these, so an assertion that signed
    // one timestamp and reported another can never verify.
    const assertion = assertDevice({ ...BASE, token: 'tok' });
    expect(assertion.signedAt).toBe(BASE.signedAt);
    expect(assertion.nonce).toBe('a-nonce');
    expect(assertion.id).toBe(IDENTITY.deviceId);
    expect(assertion.publicKey).toBe(IDENTITY.publicKeyPem);
  });

  it('emits base64, which is what the wire format expects', () => {
    const { signature } = assertDevice({ ...BASE, token: 't' });
    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe('generateDeviceIdentity', () => {
  it('derives the id from the key, so it is stable for that key pair', () => {
    // A random id would change on every restart and the gateway would see a new
    // unpaired device each time.
    const a = generateDeviceIdentity();
    expect(a.deviceId).toHaveLength(64);
    expect(generateDeviceIdentity().deviceId).not.toBe(a.deviceId);
  });
});

describe('readDeviceIdentity', () => {
  it('reads the identity OpenClaw wrote', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-device-'));
    const path = join(dir, 'device.json');
    await writeFile(path, JSON.stringify({ version: 1, ...IDENTITY, createdAtMs: 1 }));
    expect(readDeviceIdentity(path)).toEqual(IDENTITY);
  });

  it('returns undefined rather than throwing for every failure mode', async () => {
    // Missing, unreadable and malformed all mean "no identity here" to the
    // caller, and the file is 0600 so unreadable is the common case when the
    // bridge runs as a different user than OpenClaw.
    const dir = await mkdtemp(join(tmpdir(), 'sairios-device-'));
    expect(readDeviceIdentity(join(dir, 'absent.json'))).toBeUndefined();

    const bad = join(dir, 'bad.json');
    await writeFile(bad, 'not json');
    expect(readDeviceIdentity(bad)).toBeUndefined();

    const partial = join(dir, 'partial.json');
    await writeFile(partial, JSON.stringify({ deviceId: 'x' }));
    expect(readDeviceIdentity(partial)).toBeUndefined();
  });
});

describe('readGatewayToken', () => {
  it('finds the token OpenClaw keeps in its own config', async () => {
    // This is the hand-off SairiOS never had: onboarding writes the PROVIDER
    // key to a file the bridge reads and keeps the GATEWAY token here, so the
    // bridge connected with no token to a gateway that required one.
    const dir = await mkdtemp(join(tmpdir(), 'sairios-oc-'));
    const path = join(dir, 'openclaw.json');
    await writeFile(path, JSON.stringify({ gateway: { auth: { token: 'a'.repeat(48) } } }));
    expect(readGatewayToken(path)).toBe('a'.repeat(48));
  });

  it('treats an empty token as absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-oc-'));
    const path = join(dir, 'openclaw.json');
    await writeFile(path, JSON.stringify({ gateway: { auth: { token: '' } } }));
    expect(readGatewayToken(path)).toBeUndefined();
  });

  it('survives a config with no gateway section at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-oc-'));
    const path = join(dir, 'openclaw.json');
    await writeFile(path, JSON.stringify({ agents: {} }));
    expect(readGatewayToken(path)).toBeUndefined();
    expect(readGatewayToken(join(dir, 'nope.json'))).toBeUndefined();
  });
});
