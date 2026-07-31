import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { fail, ok, type Result } from '@sairios/shared';
import contextSchema from './schema/context.schema.json' with { type: 'json' };
import type { Context } from './types.js';

/**
 * Context validation.
 *
 * A context can arrive from disk, from a sync provider or from an import — all
 * of which are outside the trust boundary. Nothing becomes a `Context` in this
 * codebase without passing through here.
 */

// ajv-formats ships CJS whose `module.exports` is the plugin function, but its
// .d.ts declares both a default export and named exports. Under NodeNext that
// types the default import as the module namespace rather than the callable.
// The cast records the runtime shape Node actually provides.
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  // Reject payloads with unexpected properties instead of silently keeping them.
  removeAdditional: false,
});
addFormats(ajv);

const validator: ValidateFunction = ajv.compile(contextSchema);

export function formatAjvErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`.trim());
}

export function validateContext(value: unknown): Result<Context> {
  if (validator(value)) return ok(value as Context);
  return fail('invalid_context', 'Context failed schema validation.', {
    errors: formatAjvErrors(validator.errors),
  });
}

export function isValidContext(value: unknown): value is Context {
  return validator(value) === true;
}

export { contextSchema };
