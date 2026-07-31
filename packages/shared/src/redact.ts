/**
 * Secret redaction.
 *
 * SairiOS logs are attributable to a context and are shown to the user in the
 * activity panel. Anything that reaches a log may therefore reach the screen and
 * the audit file, so secrets are stripped at the boundary rather than at each
 * call site.
 *
 * This is defence in depth, not a licence to pass secrets around. The primary
 * control is that provider credentials never enter SairiOS process memory at all
 * (see docs/OPENCLAW.md).
 */

const SENSITIVE_KEY =
  /(api[-_]?key|token|secret|password|passwd|authorization|cookie|credential|private[-_]?key|session[-_]?id)/i;

/** Patterns for secrets that appear inside free text rather than in a named field. */
const VALUE_PATTERNS: readonly RegExp[] = [
  // Bearer / Basic auth headers
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi,
  // Common provider key shapes (sk-..., ghp_..., xoxb-...)
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // PEM blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

export const REDACTED = '[redacted]';

export function redactString(input: string): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Deep-redacts a value for logging. Returns a structurally similar value with
 * sensitive fields replaced. Cycles are broken with `[circular]`.
 */
export function redact<T>(value: T): unknown {
  return redactInner(value, new WeakSet(), 0);
}

function redactInner(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value !== 'object') return `[${typeof value}]`;

  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactInner(item, seen, depth + 1);
  }
  return out;
}
