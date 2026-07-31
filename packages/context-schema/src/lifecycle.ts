import { fail, ok, type Result } from '@sairios/shared';
import { CONTEXT_STATUSES, type Context, type ContextStatus, type ContextType } from './types.js';

/**
 * The context lifecycle state machine.
 *
 * All lifecycle logic lives here. UI components ask this module whether a
 * transition is legal; they never encode the rules themselves. When the rules
 * change, exactly one file changes and one test file covers it.
 */

export const CONTEXT_TRANSITIONS: Readonly<Record<ContextStatus, readonly ContextStatus[]>> = {
  // A context begins as an unsubmitted intention.
  draft: ['active', 'archived', 'failed'],
  // Work is happening: the agent is running or the user is editing.
  active: ['waiting', 'completed', 'failed', 'archived'],
  // Blocked on a human — almost always a pending permission decision.
  waiting: ['active', 'completed', 'failed', 'archived'],
  // Finished. Reopening is allowed: intentions come back.
  completed: ['archived', 'active'],
  // Terminal only by choice — a failed context can be retried.
  failed: ['active', 'archived'],
  // Archived contexts are restorable. Nothing is destroyed by archiving.
  archived: ['active'],
};

export interface TransitionOptions {
  /**
   * Ephemeral contexts auto-archive on completion. Set false to keep a completed
   * ephemeral context visible (used when the user is about to crystallize it).
   */
  autoArchiveEphemeral?: boolean;
}

export function canTransition(from: ContextStatus, to: ContextStatus): boolean {
  return CONTEXT_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ContextStatus): readonly ContextStatus[] {
  return CONTEXT_TRANSITIONS[from];
}

export interface TransitionResult {
  status: ContextStatus;
  /** True when the machine applied an additional implicit transition. */
  autoArchived: boolean;
}

/**
 * Computes the next status. Pure: takes the current state and returns the next
 * one, or an error explaining precisely which transition was refused.
 */
export function transition(
  current: ContextStatus,
  next: ContextStatus,
  type: ContextType,
  options: TransitionOptions = {},
): Result<TransitionResult> {
  if (!CONTEXT_STATUSES.includes(next)) {
    return fail('invalid_status', `Unknown context status: ${String(next)}`);
  }
  if (current === next) {
    return ok({ status: current, autoArchived: false });
  }
  if (!canTransition(current, next)) {
    return fail(
      'illegal_transition',
      `Cannot move a context from "${current}" to "${next}". Allowed: ${allowedTransitions(current).join(', ') || 'none'}.`,
      { from: current, to: next, allowed: allowedTransitions(current) },
    );
  }

  // Ephemeral contexts exist for a bounded task. Completing one archives it by
  // default so the context map does not silently fill with finished work.
  const autoArchive = options.autoArchiveEphemeral ?? true;
  if (next === 'completed' && type === 'ephemeral' && autoArchive) {
    return ok({ status: 'archived', autoArchived: true });
  }

  return ok({ status: next, autoArchived: false });
}

/** Statuses that mean "this context is finished and should not be resumed silently". */
export function isTerminal(status: ContextStatus): boolean {
  return status === 'archived' || status === 'completed';
}

/** Statuses that place a context in the user's active attention. */
export function isLive(status: ContextStatus): boolean {
  return status === 'active' || status === 'waiting';
}

/**
 * Guard for crystallization: only a context that has actually done something is
 * worth turning into a template.
 */
export function isCrystallizable(context: Pick<Context, 'type' | 'status'>): Result<true> {
  if (context.type === 'crystallized') {
    return fail('already_crystallized', 'This context is already a crystallized template.');
  }
  if (context.status === 'draft') {
    return fail(
      'not_crystallizable',
      'A draft context has no workflow to crystallize yet. Run it first.',
    );
  }
  return ok(true);
}
