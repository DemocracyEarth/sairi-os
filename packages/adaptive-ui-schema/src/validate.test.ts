import { describe, expect, it } from 'vitest';
import { COMPONENT_CATALOG, COMPONENT_TYPES } from './index.js';
import { errorDocument, isValidSairiUI, toSafeDocument, validateSairiUI } from './validate.js';
import type { SairiUIDocument } from './types.js';

/**
 * SairiUI validation is the boundary between model output and the screen.
 * These tests are the specification of that boundary.
 */

function doc(overrides: Partial<SairiUIDocument> = {}): SairiUIDocument {
  return {
    version: '0.1',
    contextId: 'ctx_0123456789abcdef0123456789abcdef',
    title: 'Research AI regulation',
    contextType: 'ephemeral',
    layout: {
      type: 'workspace',
      regions: [
        {
          id: 'sources',
          width: 'one-third',
          component: {
            type: 'source-list',
            binding: 'research.sources',
            props: { title: 'Sources', sources: [{ label: 'a.pdf', kind: 'file' }] },
          },
        },
        {
          id: 'notes',
          width: 'two-thirds',
          component: {
            type: 'editor',
            binding: 'research.notes',
            props: { title: 'Working notes', value: '' },
          },
        },
      ],
    },
    suggestedActions: [],
    ...overrides,
  };
}

describe('SairiUI schema', () => {
  it('accepts the protocol example from the specification', () => {
    expect(validateSairiUI(doc()).ok).toBe(true);
  });

  it('has a catalog entry for every component type and no extras', () => {
    expect(Object.keys(COMPONENT_CATALOG).sort()).toEqual([...COMPONENT_TYPES].sort());
  });

  it('rejects anything that is not a JSON object', () => {
    for (const value of [null, undefined, 'x', 7, [doc()]]) {
      const result = validateSairiUI(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe('not-an-object');
    }
  });

  it('rejects a component type outside the catalog by name', () => {
    const payload = doc();
    (payload.layout.regions[0] as { component: { type: string } }).component.type = 'iframe';
    const result = validateSairiUI(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('unknown-component');
      expect(result.error.unknownComponents).toEqual(['iframe']);
      expect(result.error.messages[0]).toContain('iframe');
    }
  });

  it('rejects a script-shaped component type', () => {
    const payload = doc();
    (payload.layout.regions[0] as { component: { type: string } }).component.type = 'script';
    expect(isValidSairiUI(payload)).toBe(false);
  });

  it('rejects an unknown prop on a known component', () => {
    const payload = doc();
    (payload.layout.regions[0].component.props as Record<string, unknown>)['onClick'] = 'alert(1)';
    const result = validateSairiUI(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('schema');
  });

  it('rejects a dangerouslySetInnerHTML-style prop', () => {
    const payload = doc();
    (payload.layout.regions[0].component.props as Record<string, unknown>)[
      'dangerouslySetInnerHTML'
    ] = { __html: '<img onerror=alert(1)>' };
    expect(isValidSairiUI(payload)).toBe(false);
  });

  it('rejects an unknown top-level property', () => {
    expect(isValidSairiUI({ ...doc(), scripts: ['x.js'] })).toBe(false);
  });

  it('rejects an unknown version', () => {
    expect(isValidSairiUI({ ...doc(), version: '0.2' })).toBe(false);
  });

  it('rejects a layout with no regions', () => {
    expect(isValidSairiUI(doc({ layout: { type: 'workspace', regions: [] } }))).toBe(false);
  });

  it('rejects an unknown layout type', () => {
    expect(
      isValidSairiUI(
        doc({ layout: { type: 'freeform' as 'stack', regions: doc().layout.regions } }),
      ),
    ).toBe(false);
  });

  it('rejects a binding that looks like a code expression', () => {
    const payload = doc();
    (payload.layout.regions[0] as { component: { binding: string } }).component.binding =
      'globalThis.fetch("http://evil")';
    expect(isValidSairiUI(payload)).toBe(false);
  });

  it('rejects an action id that carries a command line', () => {
    expect(
      isValidSairiUI(
        doc({ suggestedActions: [{ id: 'rm -rf /', label: 'Clean up', kind: 'system' }] }),
      ),
    ).toBe(false);
  });

  it('rejects an unknown capability on a suggested action', () => {
    expect(
      isValidSairiUI(
        doc({
          suggestedActions: [
            {
              id: 'do.it',
              label: 'Do it',
              kind: 'system',
              capability: 'system.shell' as 'files.read',
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('rejects a permission-request whose requestId is not a broker id', () => {
    expect(
      isValidSairiUI(
        doc({
          layout: {
            type: 'stack',
            regions: [
              {
                id: 'perm',
                component: {
                  type: 'permission-request',
                  props: {
                    capability: 'files.read',
                    reason: 'read a file',
                    risk: 'medium',
                    requestId: 'anything-goes',
                  },
                },
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a file-list entry that escapes the sandbox', () => {
    expect(
      isValidSairiUI(
        doc({
          layout: {
            type: 'stack',
            regions: [
              {
                id: 'files',
                component: {
                  type: 'file-list',
                  props: { files: [{ name: 'passwd', relativePath: '../../etc/passwd' }] },
                },
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a progress value outside 0..1', () => {
    const region = (value: number): SairiUIDocument =>
      doc({
        layout: {
          type: 'stack',
          regions: [{ id: 'p', component: { type: 'progress', props: { value } } }],
        },
      });
    expect(isValidSairiUI(region(1.5))).toBe(false);
    expect(isValidSairiUI(region(-0.2))).toBe(false);
    expect(isValidSairiUI(region(0.5))).toBe(true);
  });

  it('rejects a region id that is not a slug', () => {
    const payload = doc();
    (payload.layout.regions[0] as { id: string }).id = 'Sources; DROP TABLE';
    expect(isValidSairiUI(payload)).toBe(false);
  });

  it('accepts every catalog component with minimal valid props', () => {
    const minimal: Record<string, unknown> = {
      text: { body: 'hello' },
      markdown: { source: '# hi' },
      'source-list': { sources: [] },
      'key-value-list': { items: [] },
      editor: { value: '' },
      table: { columns: [{ key: 'a', label: 'A' }], rows: [] },
      checklist: { items: [] },
      timeline: { entries: [] },
      progress: { value: 0 },
      'status-panel': { items: [] },
      'permission-request': {
        capability: 'files.read',
        reason: 'r',
        risk: 'low',
        requestId: 'req_0123456789abcdef0123456789abcdef',
      },
      'action-button': { label: 'Go', actionId: 'go.now' },
      'terminal-output': { lines: [] },
      'file-list': { files: [] },
      'context-metadata': {},
      'activity-log': {},
    };
    for (const type of COMPONENT_TYPES) {
      const payload = doc({
        layout: {
          type: 'stack',
          regions: [{ id: 'only', component: { type, props: minimal[type] } as never }],
        },
      });
      expect(validateSairiUI(payload).ok, `${type} should validate`).toBe(true);
    }
  });
});

describe('safe error state', () => {
  it('returns a renderable document when validation fails', () => {
    const { document, failure } = toSafeDocument({ nope: true });
    expect(failure).toBeDefined();
    expect(validateSairiUI(document).ok).toBe(true);
    expect(document.layout.regions[0]?.component.type).toBe('text');
  });

  it('returns the original document when validation succeeds', () => {
    const { document, failure } = toSafeDocument(doc());
    expect(failure).toBeUndefined();
    expect(document.title).toBe('Research AI regulation');
  });

  it('produces a valid error document', () => {
    const error = errorDocument('Broken', { reason: 'schema', messages: ['/title is required'] });
    expect(validateSairiUI(error).ok).toBe(true);
  });
});

describe('precompiled validator', () => {
  it('is in step with the schema', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { generate } = await import('../scripts/build-validator.mjs');
    const path = fileURLToPath(new URL('./generated/sairi-ui-validator.js', import.meta.url));
    const onDisk = await readFile(path, 'utf8');
    expect(
      onDisk,
      'The precompiled SairiUI validator is stale. Run:\n' +
        '  npm run build:validator -w @sairios/adaptive-ui-schema',
    ).toBe(generate());
  });

  it('contains no runtime code generation', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('./generated/sairi-ui-validator.js', import.meta.url));
    const code = await readFile(path, 'utf8');
    // The shell's Content Security Policy is `script-src 'self'` with no
    // 'unsafe-eval'. Any of these would make the shell fail to mount, and would
    // undo the reason the validator is precompiled at all.
    expect(code).not.toContain('new Function');
    expect(code).not.toContain('eval(');
    expect(code).not.toContain('require(');
  });
});
