import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The device identity an OpenClaw gateway demands before it will talk.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, and why it was invisible for so long
 * ---------------------------------------------------------------------------
 * The frames in `gateway-frames.fixture.json` were captured from a gateway
 * started with `--dev --auth none --allow-unconfigured`. That gateway accepts a
 * bare `connect`. A gateway started the way the VM starts it — plain
 * `openclaw gateway --port 18789` — does not, and answers:
 *
 *     NOT_PAIRED  "device identity required"  DEVICE_IDENTITY_REQUIRED
 *
 * The tell was there the whole time and nobody read it: `connect.challenge`
 * carries a `nonce`, and the old `encodeConnect` accepted that frame and threw
 * the nonce away. A challenge nonce exists to be signed.
 *
 * ---------------------------------------------------------------------------
 * The construction
 * ---------------------------------------------------------------------------
 * Read out of OpenClaw's own client bundle, because the protocol document
 * describes the `device` object's SHAPE and not what goes into the signature:
 *
 *     v2|deviceId|clientId|clientMode|role|scopes.join(",")|signedAtMs|token|nonce
 *
 * Ed25519 over the UTF-8 bytes of that string, signature base64. `token` is the
 * gateway auth token, or an empty string when there is none — an absent token
 * is an empty field rather than an omitted one, which matters because the
 * fields are positional.
 *
 * Verified against the live gateway in the VM: with this, `connect` returns
 * `ok: true` and `sessions.create` succeeds. Getting any part of the string
 * wrong produces a signature failure rather than a helpful message, so the
 * exact order is load-bearing and `device-identity.test.ts` pins it.
 */

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/** The `device` object that goes into `connect` params. */
export interface DeviceAssertion {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export interface AssertionInput {
  identity: DeviceIdentity;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  /** The gateway auth token, if there is one. Part of the signed string. */
  token?: string | undefined;
  /** From `connect.challenge`. Empty string when the gateway sent none. */
  nonce: string;
  signedAt?: number;
}

/**
 * The exact bytes the gateway verifies.
 *
 * Exported so a test can assert the layout rather than assert that signing
 * "works" — a signature test that only round-trips its own construction would
 * pass with the fields in any order.
 */
export function canonicalPayload(input: AssertionInput & { signedAt: number }): string {
  return [
    'v2',
    input.identity.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    input.scopes.join(','),
    String(input.signedAt),
    input.token ?? '',
    input.nonce,
  ].join('|');
}

export function assertDevice(input: AssertionInput): DeviceAssertion {
  const signedAt = input.signedAt ?? Date.now();
  const payload = canonicalPayload({ ...input, signedAt });
  // `null` algorithm is how Node signs Ed25519: the curve fixes the hash, and
  // passing one is an error rather than a preference.
  const signature = sign(null, Buffer.from(payload, 'utf8'), {
    key: createPrivateKey(input.identity.privateKeyPem),
  }).toString('base64');

  return {
    id: input.identity.deviceId,
    publicKey: input.identity.publicKeyPem,
    signature,
    signedAt,
    nonce: input.nonce,
  };
}

/**
 * Reads the identity OpenClaw already created for this machine.
 *
 * Reusing OpenClaw's own device rather than minting a second one is deliberate.
 * A gateway tracks paired devices individually, so a SairiOS-specific identity
 * would arrive unpaired and sit in `openclaw devices list` waiting for someone
 * to approve it — an extra manual step, on a machine where the operator has
 * already paired the device they are using.
 */
export function readDeviceIdentity(path: string): DeviceIdentity | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const record = raw as Record<string, unknown>;
    const deviceId = record['deviceId'];
    const publicKeyPem = record['publicKeyPem'];
    const privateKeyPem = record['privateKeyPem'];
    if (
      typeof deviceId !== 'string' ||
      typeof publicKeyPem !== 'string' ||
      typeof privateKeyPem !== 'string'
    ) {
      return undefined;
    }
    return { deviceId, publicKeyPem, privateKeyPem };
  } catch {
    // Missing, unreadable or malformed all mean the same thing to the caller:
    // there is no identity here. Which one it was is not actionable, and the
    // file is 0600 so "unreadable" is the common case when the bridge runs as
    // a different user than OpenClaw.
    return undefined;
  }
}

/**
 * A fresh identity, for a machine where OpenClaw has not made one.
 *
 * This device will be UNPAIRED and the gateway will refuse it until somebody
 * runs `openclaw devices approve`. That is the correct behaviour — a new key
 * appearing and being trusted automatically would defeat the pairing model —
 * but it means the caller has to say so rather than reporting a bare failure.
 */
export function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  // The gateway keys its table on this, so it must be stable for a given key
  // pair. Derived from the public key rather than random for that reason.
  const deviceId = createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
  return { deviceId, publicKeyPem, privateKeyPem };
}

/**
 * The gateway's own auth token, from OpenClaw's config.
 *
 * SairiOS never had this. `openclaw onboard` writes the PROVIDER credential to
 * a 0600 file the bridge reads, and separately generates a gateway token that
 * it keeps in its own config — so `OPENCLAW_GATEWAY_TOKEN` was empty on a
 * machine that was, as far as the operator could tell, fully configured. The
 * gateway then answered `AUTH_TOKEN_MISSING`, which reads like a setup mistake
 * and is actually a missing hand-off.
 *
 * Read rather than copied: the token stays in OpenClaw's file, which is its
 * owner, and SairiOS holds it only for the lifetime of a connection.
 */
export function readGatewayToken(configPath: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    const gateway = (raw as Record<string, unknown> | null)?.['gateway'];
    const auth = (gateway as Record<string, unknown> | undefined)?.['auth'];
    const token = (auth as Record<string, unknown> | undefined)?.['token'];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}
