import { describe, expect, it } from 'vitest';
import { fixedClock } from '@sairios/shared';
import { createContext } from './factory.js';
import { isValidContext, validateContext } from './validate.js';
import type { Context } from './types.js';

function valid(): Context {
  return {
    ...createContext(
      { name: 'Research', type: 'persistent', objective: 'Find out' },
      fixedClock('2026-07-31T09:00:00.000Z'),
    ),
    status: 'active',
  };
}

describe('context JSON Schema validation', () => {
  it('accepts a freshly created context', () => {
    expect(validateContext(valid()).ok).toBe(true);
  });

  it('rejects a non-object', () => {
    for (const value of [null, undefined, 'ctx', 42, []]) {
      expect(isValidContext(value)).toBe(false);
    }
  });

  it('rejects an unknown top-level property', () => {
    const result = validateContext({ ...valid(), backdoor: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_context');
  });

  it('rejects a malformed id', () => {
    expect(isValidContext({ ...valid(), id: 'ctx_short' })).toBe(false);
    expect(isValidContext({ ...valid(), id: 'not-an-id' })).toBe(false);
  });

  it('rejects an unknown context type', () => {
    expect(isValidContext({ ...valid(), type: 'permanent' })).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(isValidContext({ ...valid(), status: 'running' })).toBe(false);
  });

  it('rejects a schema version it does not understand', () => {
    expect(isValidContext({ ...valid(), schemaVersion: '0.2' })).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(isValidContext({ ...valid(), name: '' })).toBe(false);
  });

  it('requires a template on a crystallized context', () => {
    expect(isValidContext({ ...valid(), type: 'crystallized' })).toBe(false);
  });

  it('accepts a crystallized context that has a template', () => {
    expect(
      isValidContext({
        ...valid(),
        type: 'crystallized',
        template: { instructions: 'do the thing', inputs: [], stages: [], permissionDefaults: {} },
      }),
    ).toBe(true);
  });

  it('rejects an unknown capability in a permission grant', () => {
    expect(
      isValidContext({
        ...valid(),
        permissions: [
          {
            capability: 'system.shell',
            decision: 'allow',
            scope: 'context',
            remembered: true,
            grantedAt: '2026-07-31T09:00:00.000Z',
            grantedBy: 'user',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects an artifact path that escapes the sandbox', () => {
    const artifact = {
      id: 'art_00000000000000000000000000000001',
      name: 'x',
      mediaType: 'text/plain',
      byteSize: 1,
      createdAt: '2026-07-31T09:00:00.000Z',
      untrusted: true,
    };
    for (const relativePath of ['../etc/passwd', '/etc/passwd', 'a/../../b', '..']) {
      expect(
        isValidContext({ ...valid(), artifacts: [{ ...artifact, relativePath }] }),
        `expected ${relativePath} to be rejected`,
      ).toBe(false);
    }
  });

  it('accepts a normal sandbox-relative artifact path', () => {
    expect(
      isValidContext({
        ...valid(),
        artifacts: [
          {
            id: 'art_00000000000000000000000000000001',
            name: 'notes.md',
            relativePath: 'notes/2026/notes.md',
            mediaType: 'text/markdown',
            byteSize: 12,
            createdAt: '2026-07-31T09:00:00.000Z',
            untrusted: false,
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects an unknown event kind', () => {
    expect(
      isValidContext({
        ...valid(),
        events: [
          {
            id: 'evt_00000000000000000000000000000001',
            kind: 'shell.exec',
            at: '2026-07-31T09:00:00.000Z',
            summary: 'x',
          },
        ],
      }),
    ).toBe(false);
  });

  it('reports readable error paths', () => {
    const result = validateContext({ ...valid(), status: 'running' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const details = result.error.details as { errors: string[] };
      expect(details.errors.join(' ')).toContain('/status');
    }
  });
});
