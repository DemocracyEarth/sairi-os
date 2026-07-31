/**
 * The isomorphic half of `@sairios/shared`.
 *
 * Nothing exported from here may import a `node:` specifier at runtime. The
 * browser shell reaches this module through the SairiUI validator, and a
 * `node:` import in that graph resolves to a stub that throws when the module
 * is evaluated — which fails as a blank screen with no error, so the rule is
 * enforced here rather than discovered later.
 *
 * Server-only helpers (environment resolution, HTTP plumbing) live in
 * `@sairios/shared/node`.
 */
export * from './ids.js';
export * from './redact.js';
export * from './logger.js';
export * from './result.js';
export * from './cloud.js';
export * from './clock.js';
