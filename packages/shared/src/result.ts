/**
 * Explicit result type used at trust boundaries.
 *
 * Anywhere SairiOS consumes untrusted input — model output, HTTP bodies, files
 * on disk — the function returns a `Result` rather than throwing, so callers are
 * forced by the type system to handle the invalid case and render a safe error
 * state instead of crashing a context window.
 */
export type Result<T, E = SairiError> = { ok: true; value: T } | { ok: false; error: E };

export interface SairiError {
  code: string;
  message: string;
  details?: unknown;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = SairiError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fail(code: string, message: string, details?: unknown): Result<never, SairiError> {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Narrow a caught `unknown` into a SairiError without losing the message. */
export function toSairiError(cause: unknown, code = 'internal_error'): SairiError {
  if (cause instanceof Error) return { code, message: cause.message };
  return { code, message: String(cause) };
}
