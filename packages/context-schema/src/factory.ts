import { newId, systemClock, type Clock } from '@sairios/shared';
import {
  CONTEXT_SCHEMA_VERSION,
  type Context,
  type ContextEvent,
  type CreateContextInput,
  type EventKind,
} from './types.js';

/**
 * The single place a `Context` comes into existence.
 *
 * Nothing else in the codebase constructs a context literal — that guarantees
 * every context has an id, a schema version, an audit trail entry and a
 * consistent initial state.
 */
export function createContext(input: CreateContextInput, clock: Clock = systemClock): Context {
  const now = clock.isoNow();
  const id = newId('ctx');

  return {
    id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    name: input.name.trim() || 'Untitled context',
    type: input.type,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    objective: input.objective.trim(),
    memory: [],
    artifacts: [],
    permissions: [],
    tasks: [],
    events: [
      {
        id: newId('evt'),
        kind: 'context.created',
        at: now,
        summary: `Context created as ${input.type}`,
      },
    ],
    uiSpecification: null,
    agentSession: { provider: 'mock', sessionId: null, status: 'idle' },
    parentContextId: input.parentContextId ?? null,
    crystallizedFrom: input.crystallizedFrom ?? null,
  };
}

export function makeEvent(
  kind: EventKind,
  summary: string,
  data?: Record<string, unknown>,
  clock: Clock = systemClock,
): ContextEvent {
  const event: ContextEvent = {
    id: newId('evt'),
    kind,
    at: clock.isoNow(),
    summary: summary.slice(0, 500),
  };
  return data === undefined ? event : { ...event, data };
}

/** Caps the retained event history so a long-lived context cannot grow without bound. */
export const MAX_EVENTS = 500;

export function appendEvent(
  context: Context,
  event: ContextEvent,
  clock: Clock = systemClock,
): Context {
  const events = [...context.events, event].slice(-MAX_EVENTS);
  return { ...context, events, updatedAt: clock.isoNow() };
}
