/**
 * Types for the generated, precompiled SairiUI validator.
 *
 * The implementation is `sairi-ui-validator.js`, produced by
 * `scripts/build-validator.mjs`. It is plain eval-free JavaScript so that it
 * runs in the shell under a `script-src 'self'` Content Security Policy.
 */
import type { ErrorObject } from 'ajv/dist/2020.js';

export interface PrecompiledValidator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

export declare const validate: PrecompiledValidator;
declare const _default: PrecompiledValidator;
export default _default;
