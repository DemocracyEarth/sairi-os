import { describe, expect, it } from 'vitest';
import { fixedClock } from '@sairios/shared';
import { createContext } from './factory.js';
import {
  CONTEXT_TRANSITIONS,
  allowedTransitions,
  canTransition,
  isCrystallizable,
  isLive,
  isTerminal,
  transition,
} from './lifecycle.js';
import { CONTEXT_STATUSES, type ContextStatus } from './types.js';

const clock = (): ReturnType<typeof fixedClock> => fixedClock('2026-07-31T09:00:00.000Z');

describe('context lifecycle', () => {
  it('defines a transition list for every status', () => {
    for (const status of CONTEXT_STATUSES) {
      expect(CONTEXT_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('never lists a status as a transition to itself', () => {
    for (const status of CONTEXT_STATUSES) {
      expect(CONTEXT_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('only names known statuses as targets', () => {
    for (const status of CONTEXT_STATUSES) {
      for (const target of CONTEXT_TRANSITIONS[status]) {
        expect(CONTEXT_STATUSES).toContain(target);
      }
    }
  });

  it('allows draft to become active', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    const result = transition('draft', 'active', 'persistent');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('active');
  });

  it('refuses to jump from draft straight to completed', () => {
    const result = transition('draft', 'completed', 'persistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('illegal_transition');
      expect(result.error.message).toContain('draft');
      expect(result.error.message).toContain('completed');
    }
  });

  it('treats a no-op transition as success without changing state', () => {
    const result = transition('active', 'active', 'persistent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('active');
      expect(result.value.autoArchived).toBe(false);
    }
  });

  it('auto-archives an ephemeral context on completion', () => {
    const result = transition('active', 'completed', 'ephemeral');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('archived');
      expect(result.value.autoArchived).toBe(true);
    }
  });

  it('keeps a completed ephemeral context visible when auto-archive is off', () => {
    const result = transition('active', 'completed', 'ephemeral', { autoArchiveEphemeral: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('completed');
      expect(result.value.autoArchived).toBe(false);
    }
  });

  it('does not auto-archive a persistent context on completion', () => {
    const result = transition('active', 'completed', 'persistent');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('completed');
  });

  it('allows an archived context to be restored', () => {
    expect(canTransition('archived', 'active')).toBe(true);
  });

  it('allows a failed context to be retried', () => {
    expect(canTransition('failed', 'active')).toBe(true);
  });

  it('rejects an unknown target status', () => {
    const result = transition('active', 'exploded' as ContextStatus, 'persistent');
    expect(result.ok).toBe(false);
  });

  it('reports allowed transitions for error messages', () => {
    expect(allowedTransitions('completed')).toEqual(['archived', 'active']);
  });

  it('classifies live and terminal statuses', () => {
    expect(isLive('active')).toBe(true);
    expect(isLive('waiting')).toBe(true);
    expect(isLive('archived')).toBe(false);
    expect(isTerminal('archived')).toBe(true);
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('draft')).toBe(false);
  });

  it('every status can eventually reach archived', () => {
    for (const start of CONTEXT_STATUSES) {
      const seen = new Set<ContextStatus>([start]);
      const queue: ContextStatus[] = [start];
      let reachable = start === 'archived';
      while (queue.length > 0 && !reachable) {
        const current = queue.shift() as ContextStatus;
        for (const next of CONTEXT_TRANSITIONS[current]) {
          if (next === 'archived') reachable = true;
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(reachable, `${start} cannot reach archived`).toBe(true);
    }
  });
});

describe('crystallization guard', () => {
  it('refuses a draft context', () => {
    const context = createContext({ name: 'x', type: 'ephemeral', objective: 'y' }, clock());
    const result = isCrystallizable(context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_crystallizable');
  });

  it('refuses a context that is already crystallized', () => {
    const result = isCrystallizable({ type: 'crystallized', status: 'active' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('already_crystallized');
  });

  it('accepts an active ephemeral context', () => {
    expect(isCrystallizable({ type: 'ephemeral', status: 'active' }).ok).toBe(true);
  });
});
