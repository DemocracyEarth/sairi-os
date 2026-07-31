import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateContext } from '@sairios/context-schema';
import { fixedClock } from '@sairios/shared';
import { demoContexts, DEMO_CONTEXT_IDS } from './seeds.js';
import { ContextService } from './service.js';
import { JsonContextStore, MemoryContextStore, createContextStore } from './store.js';

function makeService(): ContextService {
  return new ContextService({
    store: new MemoryContextStore(),
    clock: fixedClock('2026-07-31T09:00:00.000Z'),
  });
}

describe('context service', () => {
  let service: ContextService;

  beforeEach(() => {
    service = makeService();
  });

  it('creates a context in draft', async () => {
    const result = await service.create({
      name: 'Compare proposals',
      type: 'ephemeral',
      objective: 'Pick one',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('draft');
      expect(result.value.events[0]?.kind).toBe('context.created');
    }
  });

  it('refuses a context with no name', async () => {
    const result = await service.create({ name: '  ', type: 'ephemeral', objective: 'x' });
    expect(result.ok).toBe(false);
  });

  it('refuses an unknown context type', async () => {
    const result = await service.create({
      name: 'x',
      type: 'permanent' as 'ephemeral',
      objective: 'y',
    });
    expect(result.ok).toBe(false);
  });

  it('moves a draft to active when an intention is submitted', async () => {
    const created = await service.create({ name: 'x', type: 'persistent', objective: '' });
    if (!created.ok) throw new Error('expected success');
    const result = await service.submitIntention(created.value.id, 'Find out about X');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('active');
      expect(result.value.objective).toBe('Find out about X');
      expect(result.value.events.map((e) => e.kind)).toContain('intention.submitted');
    }
  });

  it('refuses an empty intention', async () => {
    const created = await service.create({ name: 'x', type: 'persistent', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    expect((await service.submitIntention(created.value.id, '   ')).ok).toBe(false);
  });

  it('enforces the lifecycle state machine on status changes', async () => {
    const created = await service.create({ name: 'x', type: 'persistent', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    const illegal = await service.setStatus(created.value.id, 'completed');
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe('illegal_transition');
  });

  it('auto-archives an ephemeral context on completion', async () => {
    const created = await service.create({ name: 'x', type: 'ephemeral', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    await service.submitIntention(created.value.id, 'do it');
    const done = await service.setStatus(created.value.id, 'completed');
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.value.status).toBe('archived');
  });

  it('stores a valid SairiUI document', async () => {
    const created = await service.create({ name: 'x', type: 'persistent', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    const result = await service.setUiSpecification(created.value.id, {
      version: '0.1',
      contextId: created.value.id,
      title: 'x',
      contextType: 'persistent',
      layout: {
        type: 'stack',
        regions: [{ id: 'a', component: { type: 'text', props: { body: 'hi' } } }],
      },
      suggestedActions: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.uiSpecification).not.toBeNull();
  });

  it('refuses to persist an invalid SairiUI document and records the rejection', async () => {
    const created = await service.create({ name: 'x', type: 'persistent', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    const result = await service.setUiSpecification(created.value.id, {
      version: '0.1',
      contextId: created.value.id,
      title: 'x',
      contextType: 'persistent',
      layout: {
        type: 'stack',
        regions: [{ id: 'a', component: { type: 'script', props: { src: 'evil.js' } } }],
      },
      suggestedActions: [],
    });
    expect(result.ok).toBe(false);

    const stored = await service.get(created.value.id);
    expect(stored?.uiSpecification).toBeNull();
    expect(stored?.events.map((e) => e.kind)).toContain('ui.specification-rejected');
  });

  it('filters contexts by type and status', async () => {
    await service.create({ name: 'a', type: 'ephemeral', objective: 'x' });
    await service.create({ name: 'b', type: 'persistent', objective: 'x' });
    expect(await service.list({ type: 'ephemeral' })).toHaveLength(1);
    expect(await service.list({ status: 'draft' })).toHaveLength(2);
  });

  it('renames a context and logs it', async () => {
    const created = await service.create({ name: 'a', type: 'persistent', objective: 'x' });
    if (!created.ok) throw new Error('expected success');
    const renamed = await service.rename(created.value.id, 'b');
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.name).toBe('b');
      expect(renamed.value.events.map((e) => e.kind)).toContain('context.renamed');
    }
  });

  it('reports not_found for an unknown context', async () => {
    const result = await service.setStatus('ctx_00000000000000000000000000000000', 'active');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});

describe('crystallization through the service', () => {
  it('creates a template and records it on the source', async () => {
    const service = makeService();
    const created = await service.create({ name: 'Compare', type: 'ephemeral', objective: 'x' });
    if (!created.ok) throw new Error('expected success');
    await service.submitIntention(created.value.id, 'Compare three proposals');

    const result = await service.crystallize(created.value.id, { name: 'Comparison template' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.context.type).toBe('crystallized');
    expect(result.value.context.name).toBe('Comparison template');

    const source = await service.get(created.value.id);
    expect(source?.events.map((e) => e.kind)).toContain('context.crystallized');
  });

  it('instantiates a run from a template', async () => {
    const service = makeService();
    const created = await service.create({ name: 'Compare', type: 'ephemeral', objective: 'x' });
    if (!created.ok) throw new Error('expected success');
    await service.submitIntention(created.value.id, 'Compare three proposals');
    const template = await service.crystallize(created.value.id);
    if (!template.ok) throw new Error('expected success');

    const run = await service.instantiate(template.value.context.id, {});
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.crystallizedFrom).toBe(template.value.context.id);
      expect(run.value.type).toBe('ephemeral');
      expect(run.value.events.map((e) => e.kind)).toContain('context.instantiated');
      // A new run starts with no grants: the template's defaults are hints only.
      expect(run.value.permissions).toHaveLength(0);
    }
  });

  it('refuses to instantiate something that is not a template', async () => {
    const service = makeService();
    const created = await service.create({ name: 'x', type: 'persistent', objective: 'y' });
    if (!created.ok) throw new Error('expected success');
    const result = await service.instantiate(created.value.id, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_a_template');
  });

  it('requires the template inputs that are marked required', async () => {
    const service = makeService();
    for (const context of demoContexts()) {
      const created = await service.create({
        name: context.name,
        type: 'ephemeral',
        objective: context.objective,
      });
      void created;
    }
    // The seeded briefing template requires a "week" input.
    const store = new MemoryContextStore();
    const seeded = new ContextService({ store, clock: fixedClock('2026-07-31T09:00:00.000Z') });
    for (const context of demoContexts()) await store.put(context);

    const missing = await seeded.instantiate(DEMO_CONTEXT_IDS.crystallized, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('missing_inputs');

    const provided = await seeded.instantiate(DEMO_CONTEXT_IDS.crystallized, {
      values: { week: '2026-08-03' },
    });
    expect(provided.ok).toBe(true);
  });
});

describe('demo seeds', () => {
  it('produces one context per type', () => {
    const contexts = demoContexts();
    expect(contexts.map((c) => c.type).sort()).toEqual(['crystallized', 'ephemeral', 'persistent']);
  });

  it('produces contexts that pass schema validation', () => {
    for (const context of demoContexts()) {
      const result = validateContext(context);
      expect(result.ok, `${context.name}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(demoContexts())).toBe(JSON.stringify(demoContexts()));
  });

  it('ships UI specifications that pass SairiUI validation', async () => {
    const { validateSairiUI } = await import('@sairios/adaptive-ui-schema');
    for (const context of demoContexts()) {
      const result = validateSairiUI(context.uiSpecification);
      expect(result.ok, `${context.name}: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});

describe('context store', () => {
  it('round-trips a context through the JSON store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-store-'));
    const path = join(dir, 'contexts.json');
    const first = new JsonContextStore(path);
    await first.init();
    const [context] = demoContexts();
    if (!context) throw new Error('expected a demo context');
    await first.put(context);
    await first.close();

    const second = new JsonContextStore(path);
    await second.init();
    const loaded = await second.get(context.id);
    expect(loaded?.name).toBe(context.name);
  });

  it('drops a stored document that no longer validates instead of crashing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-store-'));
    const path = join(dir, 'contexts.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify([{ id: 'not-a-context' }, ...demoContexts()]));
    const store = new JsonContextStore(path);
    await store.init();
    expect(await store.list()).toHaveLength(3);
  });

  it('auto-selects a driver and persists across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sairios-store-'));
    const store = await createContextStore('auto', dir);
    const [context] = demoContexts();
    if (!context) throw new Error('expected a demo context');
    await store.put(context);
    expect((await store.list()).length).toBe(1);
    await store.close();

    const reopened = await createContextStore('auto', dir);
    expect((await reopened.get(context.id))?.name).toBe(context.name);
    await reopened.close();
  });

  it('deletes a context', async () => {
    const store = new MemoryContextStore();
    const [context] = demoContexts();
    if (!context) throw new Error('expected a demo context');
    await store.put(context);
    expect(await store.delete(context.id)).toBe(true);
    expect(await store.delete(context.id)).toBe(false);
  });
});
