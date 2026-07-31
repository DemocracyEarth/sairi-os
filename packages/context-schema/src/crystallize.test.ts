import { describe, expect, it } from 'vitest';
import { fixedClock } from '@sairios/shared';
import { crystallize, previewCrystallization, sanitizeUiSpecification } from './crystallize.js';
import { createContext } from './factory.js';
import { validateContext } from './validate.js';
import type { Context } from './types.js';

/**
 * Crystallization sanitization is the security-relevant half of the feature: a
 * template is the artefact most likely to leave the machine. These tests assert
 * what must NOT survive, not just what does.
 */

function ranContext(overrides: Partial<Context> = {}): Context {
  const base = createContext(
    { name: 'Compare three vendor proposals', type: 'ephemeral', objective: 'Pick a vendor' },
    fixedClock('2026-07-31T09:00:00.000Z'),
  );
  return {
    ...base,
    status: 'active',
    memory: [
      {
        key: 'budget-ceiling',
        value: '150000 EUR',
        scope: 'durable',
        sensitive: false,
        updatedAt: base.createdAt,
      },
      {
        key: 'call-transcript',
        value: 'private call notes',
        scope: 'working',
        sensitive: true,
        updatedAt: base.createdAt,
      },
      {
        key: 'vendor-api-key',
        value: 'sk-live-abc123456789',
        scope: 'durable',
        sensitive: false,
        updatedAt: base.createdAt,
      },
      {
        key: 'scratch',
        value: 'temp',
        scope: 'ephemeral',
        sensitive: false,
        updatedAt: base.createdAt,
      },
    ],
    artifacts: [
      {
        id: 'art_00000000000000000000000000000001',
        name: 'northgate.pdf',
        relativePath: 'proposals/northgate.pdf',
        mediaType: 'application/pdf',
        byteSize: 1024,
        createdAt: base.createdAt,
        untrusted: true,
      },
    ],
    permissions: [
      {
        capability: 'files.read',
        decision: 'allow',
        scope: 'context',
        remembered: true,
        grantedAt: base.createdAt,
        grantedBy: 'user',
      },
      {
        capability: 'files.delete',
        decision: 'deny',
        scope: 'context',
        remembered: true,
        grantedAt: base.createdAt,
        grantedBy: 'user',
      },
      {
        capability: 'network.fetch',
        decision: 'allow',
        scope: 'once',
        remembered: false,
        grantedAt: base.createdAt,
        grantedBy: 'user',
      },
    ],
    events: [
      ...base.events,
      {
        id: 'evt_00000000000000000000000000000001',
        kind: 'agent.message',
        at: base.createdAt,
        summary: 'private conversation content',
      },
      {
        id: 'evt_00000000000000000000000000000002',
        kind: 'permission.decided',
        at: base.createdAt,
        summary: 'allow',
      },
      {
        id: 'evt_00000000000000000000000000000003',
        kind: 'action.executed',
        at: base.createdAt,
        summary: 'read a file',
      },
    ],
    uiSpecification: {
      version: '0.1',
      contextId: base.id,
      title: 'Compare three vendor proposals',
      contextType: 'ephemeral',
      layout: {
        type: 'workspace',
        regions: [
          {
            id: 'comparison',
            width: 'two-thirds',
            component: {
              type: 'table',
              binding: 'proposals.comparison',
              props: {
                title: 'Comparison',
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: 'secret figure' }],
              },
            },
          },
        ],
      },
      suggestedActions: [],
    },
    agentSession: { provider: 'mock', sessionId: 'ses_live', status: 'idle' },
    ...overrides,
  };
}

describe('crystallization sanitization', () => {
  it('produces a valid crystallized context', () => {
    const result = crystallize(ranContext(), { clock: fixedClock('2026-08-01T09:00:00.000Z') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.context.type).toBe('crystallized');
    expect(result.value.context.template).toBeDefined();
    expect(validateContext(result.value.context).ok).toBe(true);
  });

  it('drops memory whose key looks like a credential', () => {
    const result = crystallize(ranContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.value.context.memory.map((m) => m.key);
    expect(keys).not.toContain('vendor-api-key');
    expect(JSON.stringify(result.value.context)).not.toContain('sk-live-abc123456789');
  });

  it('drops memory marked sensitive', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.memory.map((m) => m.key)).not.toContain('call-transcript');
  });

  it('drops non-durable memory scopes', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.memory.map((m) => m.key)).not.toContain('scratch');
  });

  it('keeps durable, non-sensitive memory', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.memory.map((m) => m.key)).toContain('budget-ceiling');
  });

  it('carries no files into the template', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.artifacts).toHaveLength(0);
  });

  it('carries no conversation content into the template', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    const serialized = JSON.stringify(result.value.context);
    expect(serialized).not.toContain('private conversation content');
    expect(result.value.context.events.every((e) => e.kind === 'context.crystallized')).toBe(true);
  });

  it('carries no live agent session into the template', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.agentSession.sessionId).toBeNull();
  });

  it('downgrades a remembered allow to ask in the template defaults', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.template?.permissionDefaults['files.read']).toBe('ask');
  });

  it('preserves a remembered deny in the template defaults', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.template?.permissionDefaults['files.delete']).toBe('deny');
  });

  it('ignores once-scoped grants when deriving defaults', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.template?.permissionDefaults['network.fetch']).toBeUndefined();
  });

  it('grants nothing to the new template context', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.permissions).toHaveLength(0);
  });

  it('keeps the layout skeleton but drops the previous run’s row data', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    const serialized = JSON.stringify(result.value.context.uiSpecification);
    expect(serialized).toContain('table');
    expect(serialized).toContain('proposals.comparison');
    expect(serialized).not.toContain('secret figure');
  });

  it('derives approval stages from the execution shape, not its content', () => {
    const result = crystallize(ranContext());
    if (!result.ok) throw new Error('expected success');
    const stages = result.value.context.template?.stages ?? [];
    expect(stages.some((s) => s.requiresApproval)).toBe(true);
    expect(JSON.stringify(stages)).not.toContain('read a file');
  });

  it('records the source context as the parent', () => {
    const source = ranContext();
    const result = crystallize(source);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.context.parentContextId).toBe(source.id);
  });

  it('does not mutate the source context', () => {
    const source = ranContext();
    const before = JSON.stringify(source);
    crystallize(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('refuses a context that is already crystallized', () => {
    const result = crystallize(ranContext({ type: 'crystallized' }));
    expect(result.ok).toBe(false);
  });

  it('refuses a draft context', () => {
    const result = crystallize(ranContext({ status: 'draft' }));
    expect(result.ok).toBe(false);
  });
});

describe('crystallization preview', () => {
  it('lists both what is retained and what is removed with reasons', () => {
    const preview = previewCrystallization(ranContext());
    expect(preview.retained.length).toBeGreaterThan(0);
    expect(preview.discarded.length).toBeGreaterThan(0);
    expect(preview.discarded.every((d) => d.reason.length > 0)).toBe(true);
  });

  it('flags a credential-shaped memory key as a secret', () => {
    const preview = previewCrystallization(ranContext());
    expect(preview.discarded.some((d) => d.category === 'secret')).toBe(true);
  });

  it('matches what crystallize actually removes', () => {
    const source = ranContext();
    const preview = previewCrystallization(source);
    const result = crystallize(source);
    if (!result.ok) throw new Error('expected success');
    for (const dropped of preview.discarded.filter((d) => d.label.startsWith('Memory: '))) {
      const key = dropped.label.replace('Memory: ', '');
      expect(result.value.context.memory.map((m) => m.key)).not.toContain(key);
    }
  });
});

describe('sanitizeUiSpecification', () => {
  it('returns null for a non-object', () => {
    expect(sanitizeUiSpecification('nope')).toBeNull();
    expect(sanitizeUiSpecification(null)).toBeNull();
    expect(sanitizeUiSpecification(42)).toBeNull();
  });

  it('returns null when there is no layout', () => {
    expect(sanitizeUiSpecification({ version: '0.1' })).toBeNull();
  });

  it('strips inline region data', () => {
    const cleaned = sanitizeUiSpecification({
      version: '0.1',
      title: 'x',
      layout: {
        type: 'workspace',
        regions: [
          { id: 'a', component: { type: 'text', props: { body: 'keep' } }, data: 'drop me' },
        ],
      },
    }) as { layout: { regions: Record<string, unknown>[] } };
    expect(cleaned.layout.regions[0]).not.toHaveProperty('data');
  });

  it('clears the context id so a template is not bound to one run', () => {
    const cleaned = sanitizeUiSpecification({
      version: '0.1',
      contextId: 'ctx_00000000000000000000000000000001',
      title: 'x',
      layout: {
        type: 'stack',
        regions: [{ id: 'a', component: { type: 'text', props: { body: 'x' } } }],
      },
    }) as { contextId: unknown };
    expect(cleaned.contextId).toBeNull();
  });

  it('returns null rather than an empty layout the schema would reject', () => {
    expect(
      sanitizeUiSpecification({ version: '0.1', layout: { type: 'stack', regions: [] } }),
    ).toBeNull();
  });

  it('drops a permission-request region instead of carrying a stale request id', () => {
    const cleaned = sanitizeUiSpecification({
      version: '0.1',
      title: 'x',
      layout: {
        type: 'stack',
        regions: [
          { id: 'keep', component: { type: 'text', props: { body: 'hello' } } },
          {
            id: 'perm',
            component: {
              type: 'permission-request',
              props: {
                capability: 'files.read',
                reason: 'r',
                risk: 'low',
                requestId: 'req_0123456789abcdef0123456789abcdef',
              },
            },
          },
        ],
      },
    }) as { layout: { regions: { id: string }[] } };
    expect(cleaned.layout.regions.map((r) => r.id)).toEqual(['keep']);
  });

  it('keeps table columns but empties the rows', () => {
    const cleaned = sanitizeUiSpecification({
      version: '0.1',
      title: 'x',
      layout: {
        type: 'stack',
        regions: [
          {
            id: 't',
            component: {
              type: 'table',
              props: { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'run data' }] },
            },
          },
        ],
      },
    }) as {
      layout: { regions: { component: { props: { columns: unknown[]; rows: unknown[] } } }[] };
    };
    expect(cleaned.layout.regions[0]?.component.props.columns).toHaveLength(1);
    expect(cleaned.layout.regions[0]?.component.props.rows).toEqual([]);
  });

  it('keeps checklist steps but resets their ticked state and per-run notes', () => {
    const cleaned = sanitizeUiSpecification({
      version: '0.1',
      title: 'x',
      layout: {
        type: 'stack',
        regions: [
          {
            id: 'c',
            component: {
              type: 'checklist',
              props: {
                items: [{ id: 'step1', label: 'Do it', checked: true, note: 'run detail' }],
              },
            },
          },
        ],
      },
    }) as { layout: { regions: { component: { props: { items: Record<string, unknown>[] } } }[] } };
    const item = cleaned.layout.regions[0]?.component.props.items[0];
    expect(item).toEqual({ id: 'step1', label: 'Do it', checked: false });
  });
});
