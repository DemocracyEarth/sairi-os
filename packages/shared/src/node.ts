/**
 * The Node-only half of `@sairios/shared`.
 *
 * Imported by the three background services and by tests. Never by the shell.
 * Keeping these behind a separate entry point is what stops `node:path` and
 * friends from being dragged into the browser bundle by a transitive import.
 */
export * from './env.js';
export * from './http.js';
