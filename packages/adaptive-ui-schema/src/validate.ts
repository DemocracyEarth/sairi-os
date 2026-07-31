import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ok, type Result } from '@sairios/shared';
import sairiUiSchema from './schema/sairi-ui.schema.json' with { type: 'json' };
import { COMPONENT_TYPES, type SairiUIDocument } from './types.js';

/**
 * SairiUI validation — the single gate between model output and the screen.
 *
 * Rules enforced here:
 *   - the document must match the schema exactly (`additionalProperties: false`);
 *   - unknown component types are rejected by name, with a readable message;
 *   - a rejected document never partially renders — the caller shows an error state.
 */

// See the note in @sairios/context-schema/validate.ts: ajv-formats' CJS export
// is the plugin function, but its typings describe a namespace.
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validator: ValidateFunction = ajv.compile(sairiUiSchema);

export interface UiValidationFailure {
  /** Machine-readable reason, used by the shell to pick an error presentation. */
  reason: 'not-an-object' | 'unknown-component' | 'schema';
  messages: string[];
  unknownComponents?: string[];
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of errors) {
    const message = `${e.instancePath || '<root>'} ${e.message ?? 'is invalid'}`.trim();
    if (seen.has(message)) continue;
    seen.add(message);
    out.push(message);
  }
  return out.slice(0, 25);
}

/**
 * Scans for component types outside the catalog before schema validation, so the
 * failure the user sees names the offending component instead of drowning in
 * generic `if/then` errors.
 */
function findUnknownComponents(value: unknown): string[] {
  const unknown: string[] = [];
  const regions = (value as { layout?: { regions?: unknown } })?.layout?.regions;
  if (!Array.isArray(regions)) return unknown;
  for (const region of regions) {
    const type = (region as { component?: { type?: unknown } })?.component?.type;
    if (typeof type === 'string' && !(COMPONENT_TYPES as readonly string[]).includes(type)) {
      unknown.push(type);
    }
  }
  return unknown;
}

export function validateSairiUI(value: unknown): Result<SairiUIDocument, UiValidationFailure> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: { reason: 'not-an-object', messages: ['SairiUI payload must be a JSON object.'] },
    };
  }

  const unknownComponents = findUnknownComponents(value);
  if (unknownComponents.length > 0) {
    return {
      ok: false,
      error: {
        reason: 'unknown-component',
        messages: unknownComponents.map(
          (t) => `Component type "${t}" is not in the SairiUI v0 catalog and will not be rendered.`,
        ),
        unknownComponents,
      },
    };
  }

  if (validator(value)) return ok(value as SairiUIDocument);

  return {
    ok: false,
    error: { reason: 'schema', messages: formatErrors(validator.errors) },
  };
}

export function isValidSairiUI(value: unknown): value is SairiUIDocument {
  return validateSairiUI(value).ok;
}

/**
 * Convenience for callers that want a renderable document no matter what:
 * returns the validated document, or a minimal one describing the failure.
 */
export function toSafeDocument(
  value: unknown,
  fallbackTitle = 'Invalid interface',
): { document: SairiUIDocument; failure?: UiValidationFailure } {
  const result = validateSairiUI(value);
  if (result.ok) return { document: result.value };
  return { document: errorDocument(fallbackTitle, result.error), failure: result.error };
}

export function errorDocument(title: string, failure: UiValidationFailure): SairiUIDocument {
  return {
    version: '0.1',
    contextId: null,
    title,
    contextType: 'ephemeral',
    layout: {
      type: 'stack',
      regions: [
        {
          id: 'error',
          width: 'full',
          component: {
            type: 'text',
            props: {
              title: 'The agent returned an interface SairiOS could not verify',
              tone: 'warning',
              body:
                'Nothing was rendered from that response. This is the expected behaviour when ' +
                'model output does not match the SairiUI protocol.\n\n' +
                failure.messages.slice(0, 8).join('\n'),
            },
          },
        },
      ],
    },
    suggestedActions: [],
  };
}

export { sairiUiSchema };
export const validateSairiUiErrors = (): string[] => formatErrors(validator.errors);
