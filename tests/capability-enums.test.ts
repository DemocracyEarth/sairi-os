import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@sairios/context-schema';

/**
 * The capability list is written down in three places, and two of them are JSON.
 *
 * `CAPABILITIES` is the source of truth, and TypeScript keeps most consumers
 * honest: `DEFAULT_POLICIES` and `CAPABILITY_DESCRIPTORS` are total records over
 * the union, and `runAction`'s switch ends in a `never` assignment, so a new
 * capability that misses any of them fails the build.
 *
 * The two JSON Schemas have none of that. They hand-list the same strings, no
 * type connects them, and the TypeScript that surrounds them declares
 * `capability: string` rather than the union — so a drift is invisible to the
 * compiler, invisible in review, and produces a failure a long way from its
 * cause.
 *
 * It had already happened. `audio.capture` was added to `CAPABILITIES` for the
 * voice work and never added to the SairiUI schema, so for the whole life of
 * that feature any agent document naming it in a `permission-request`, a
 * `suggestedAction` or an `actionButton` was rejected — and rejection is
 * WHOLE-DOCUMENT, so one unknown string threw away the entire interface. The
 * agent looked broken and the schema looked fine.
 *
 * These are cross-package assertions, which is why they live here rather than in
 * either package: neither schema package depends on the other, and the whole
 * point is to compare them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const json = (path: string): unknown => JSON.parse(readFileSync(join(here, '..', path), 'utf8'));

/** The one enum in a schema whose members are capability names. */
function capabilityEnum(node: unknown): string[] | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = capabilityEnum(child);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) return undefined;
  const record = node as Record<string, unknown>;
  const values = record['enum'];
  if (Array.isArray(values) && values.some((v) => v === 'files.read')) {
    return values as string[];
  }
  for (const child of Object.values(record)) {
    const found = capabilityEnum(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Capabilities a MODEL may not name, and why.
 *
 * The SairiUI schema is the boundary between model output and the screen, so its
 * enum answers a different question from the context schema's: not "does this
 * capability exist" but "may an agent-authored document mention it". Those
 * differ, and the difference has to be deliberate and written down — the last
 * time these enums disagreed it was an accident that rejected whole documents
 * for a year.
 *
 * `agent.relay` is excluded. It hands work to another agent, its default policy
 * is `deny`, and it has no approval view worth reading yet. A document naming it
 * could only ask the user to approve a hop whose details the approval surface
 * cannot show. It goes in when that view exists.
 */
const NOT_MODEL_NAMEABLE: Record<string, readonly string[]> = {
  'packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json': ['agent.relay'],
};

const SCHEMAS = {
  'the SairiUI protocol': 'packages/adaptive-ui-schema/src/schema/sairi-ui.schema.json',
  'the context schema': 'packages/context-schema/src/schema/context.schema.json',
} as const;

describe('every schema knows every capability', () => {
  for (const [name, path] of Object.entries(SCHEMAS)) {
    it(`${name} lists exactly the capabilities that exist`, () => {
      const listed = capabilityEnum(json(path));
      expect(listed, `${path} has no capability enum — did it move?`).toBeDefined();
      // Sorted: the schemas may order them for reading, and order is not the
      // thing that matters. Membership is.
      const excluded = NOT_MODEL_NAMEABLE[path] ?? [];
      const expected = CAPABILITIES.filter((c) => !excluded.includes(c));
      expect([...(listed as string[])].sort()).toEqual([...expected].sort());
    });
  }

  it('keeps every exclusion real, so the carve-outs cannot outlive their reason', () => {
    // An exception list naming a capability that no longer exists is a silent
    // hole: the enum would then be free to drop a real capability under cover of
    // a stale carve-out.
    for (const [path, excluded] of Object.entries(NOT_MODEL_NAMEABLE)) {
      for (const capability of excluded) {
        expect(
          CAPABILITIES as readonly string[],
          `${path} excludes "${capability}", which is not a capability`,
        ).toContain(capability);
      }
    }
  });

  it('finds the enum by content, so renaming the $def cannot silence this', () => {
    // The locator above matches on a member rather than on a key name. If it
    // matched `$defs.capability`, moving or renaming that definition would make
    // both assertions above vacuously pass.
    expect(capabilityEnum({ anything: { enum: ['files.read', 'files.write'] } })).toEqual([
      'files.read',
      'files.write',
    ]);
    expect(capabilityEnum({ enum: ['stack', 'grid'] })).toBeUndefined();
  });
});
