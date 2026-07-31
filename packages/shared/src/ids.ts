/**
 * Identifiers.
 *
 * Uses the Web Crypto global rather than `node:crypto` so this module stays
 * isomorphic: `@sairios/shared` is imported by the browser shell through the
 * SairiUI validator, and a `node:` specifier there becomes a stub that throws
 * on evaluation. Node 19+ and every supported browser expose
 * `globalThis.crypto.randomUUID`.
 */
function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * SairiOS identifiers are prefixed so that a bare string in a log line, an audit
 * record or a model response is self-describing. Never generate these in the UI —
 * identity is assigned by the owning service.
 */
export type IdPrefix = 'ctx' | 'tsk' | 'evt' | 'art' | 'perm' | 'req' | 'ses' | 'act' | 'tpl';

const ID_PATTERN = /^(ctx|tsk|evt|art|perm|req|ses|act|tpl)_[0-9a-f]{32}$/;

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function isId(value: unknown, prefix?: IdPrefix): value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return false;
  if (prefix && !value.startsWith(`${prefix}_`)) return false;
  return true;
}

/**
 * Deterministic identifier used by seeded demo data and by tests, so that
 * fixtures stay stable across runs. Not cryptographically random — never use
 * for anything security-relevant.
 */
export function seededId(prefix: IdPrefix, seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const block = (n: number): string => n.toString(16).padStart(8, '0');
  const body = `${block(h1)}${block(h2)}${block(Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0)}${block(
    Math.imul(h1 + h2, 0x27d4eb2f) >>> 0,
  )}`;
  return `${prefix}_${body.slice(0, 32)}`;
}
