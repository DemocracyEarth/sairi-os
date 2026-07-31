import { validateSairiUI } from '@sairios/adaptive-ui-schema';
import {
  appendEvent,
  createContext,
  crystallize,
  makeEvent,
  previewCrystallization,
  transition,
  validateContext,
  type Context,
  type ContextStatus,
  type ContextType,
  type CrystallizationPreview,
  type CreateContextInput,
  type Task,
  type TemplateInput,
} from '@sairios/context-schema';
import { fail, newId, ok, systemClock, type Clock, type Result } from '@sairios/shared';
import type { ContextStore } from './store.js';

/**
 * The context domain service.
 *
 * Owns the invariants:
 *   - every status change goes through the lifecycle state machine;
 *   - every UI specification is validated before it is stored, so an invalid
 *     document can never be persisted and replayed into the renderer later;
 *   - every mutation appends an event, so the activity log is complete by
 *     construction rather than by discipline.
 */

export interface ContextServiceOptions {
  store: ContextStore;
  clock?: Clock;
}

export class ContextService {
  readonly #store: ContextStore;
  readonly #clock: Clock;

  constructor(options: ContextServiceOptions) {
    this.#store = options.store;
    this.#clock = options.clock ?? systemClock;
  }

  async list(filter?: { type?: ContextType; status?: ContextStatus }): Promise<Context[]> {
    const all = await this.#store.list();
    return all.filter(
      (c) =>
        (!filter?.type || c.type === filter.type) &&
        (!filter?.status || c.status === filter.status),
    );
  }

  async get(id: string): Promise<Context | undefined> {
    return this.#store.get(id);
  }

  async create(input: CreateContextInput): Promise<Result<Context>> {
    if (typeof input?.name !== 'string' || input.name.trim().length === 0) {
      return fail('invalid_input', 'A context needs a name.');
    }
    if (
      input.type !== 'ephemeral' &&
      input.type !== 'persistent' &&
      input.type !== 'crystallized'
    ) {
      return fail('invalid_input', 'Context type must be ephemeral, persistent or crystallized.');
    }
    const context = createContext(input, this.#clock);
    const validated = validateContext(context);
    if (!validated.ok) return validated;
    await this.#store.put(validated.value);
    return ok(validated.value);
  }

  /** Records the user's intention and moves the context out of draft. */
  async submitIntention(id: string, intention: string): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    const text = String(intention ?? '').trim();
    if (!text) return fail('invalid_input', 'An intention cannot be empty.');

    let next: Context = appendEvent(
      { ...context, objective: context.objective || text.slice(0, 4000) },
      makeEvent('intention.submitted', text.slice(0, 500), undefined, this.#clock),
      this.#clock,
    );

    if (next.status === 'draft') {
      const moved = this.#applyTransition(next, 'active');
      if (!moved.ok) return moved;
      next = moved.value;
    }

    return this.#save(next);
  }

  async setStatus(id: string, status: ContextStatus): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    const moved = this.#applyTransition(context, status);
    if (!moved.ok) return moved;
    return this.#save(moved.value);
  }

  async rename(id: string, name: string): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return fail('invalid_input', 'A context name cannot be empty.');
    const next = appendEvent(
      { ...context, name: trimmed.slice(0, 200) },
      makeEvent('context.renamed', `Renamed to "${trimmed}"`, undefined, this.#clock),
      this.#clock,
    );
    return this.#save(next);
  }

  /**
   * Stores an agent-produced SairiUI document.
   *
   * Rejection is recorded as an event so the user can see that the agent
   * returned something unrenderable, rather than the failure vanishing.
   */
  async setUiSpecification(id: string, spec: unknown): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');

    const validated = validateSairiUI(spec);
    if (!validated.ok) {
      const rejected = appendEvent(
        context,
        makeEvent(
          'ui.specification-rejected',
          `Rejected an invalid interface (${validated.error.reason})`,
          { messages: validated.error.messages.slice(0, 5) },
          this.#clock,
        ),
        this.#clock,
      );
      await this.#store.put(rejected);
      return fail('invalid_ui_specification', 'The SairiUI document failed validation.', {
        reason: validated.error.reason,
        messages: validated.error.messages,
      });
    }

    const next = appendEvent(
      { ...context, uiSpecification: validated.value },
      makeEvent(
        'ui.specification-updated',
        `Interface updated (${validated.value.layout.regions.length} regions)`,
        undefined,
        this.#clock,
      ),
      this.#clock,
    );
    return this.#save(next);
  }

  async addTask(id: string, title: string): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    const trimmed = String(title ?? '').trim();
    if (!trimmed) return fail('invalid_input', 'A task needs a title.');
    const now = this.#clock.isoNow();
    const task: Task = {
      id: newId('tsk'),
      title: trimmed.slice(0, 500),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    return this.#save({ ...context, tasks: [...context.tasks, task], updatedAt: now });
  }

  async appendEventTo(
    id: string,
    kind: Parameters<typeof makeEvent>[0],
    summary: string,
    data?: Record<string, unknown>,
  ): Promise<Result<Context>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    return this.#save(
      appendEvent(context, makeEvent(kind, summary, data, this.#clock), this.#clock),
    );
  }

  // --- crystallization -----------------------------------------------------

  async previewCrystallize(id: string): Promise<Result<CrystallizationPreview>> {
    const context = await this.#store.get(id);
    if (!context) return fail('not_found', 'No such context.');
    return ok(previewCrystallization(context));
  }

  async crystallize(
    id: string,
    options: { name?: string; instructions?: string; inputs?: readonly TemplateInput[] } = {},
  ): Promise<Result<{ context: Context; preview: CrystallizationPreview }>> {
    const source = await this.#store.get(id);
    if (!source) return fail('not_found', 'No such context.');

    const result = crystallize(source, { ...options, clock: this.#clock });
    if (!result.ok) return result;

    const validated = validateContext(result.value.context);
    if (!validated.ok) return validated;

    await this.#store.put(validated.value);

    // Record on the source that it produced a template.
    await this.#store.put(
      appendEvent(
        source,
        makeEvent(
          'context.crystallized',
          `Crystallized into "${validated.value.name}"`,
          { templateContextId: validated.value.id },
          this.#clock,
        ),
        this.#clock,
      ),
    );

    return ok({ context: validated.value, preview: result.value.preview });
  }

  /** Creates a fresh working context from a crystallized template. */
  async instantiate(
    templateId: string,
    input: { name?: string; type?: 'ephemeral' | 'persistent'; values?: Record<string, string> },
  ): Promise<Result<Context>> {
    const template = await this.#store.get(templateId);
    if (!template) return fail('not_found', 'No such template.');
    if (template.type !== 'crystallized' || !template.template) {
      return fail('not_a_template', 'Only a crystallized context can be instantiated.');
    }

    const missing = template.template.inputs
      .filter((i) => i.required && !(input.values?.[i.name] ?? i.defaultValue))
      .map((i) => i.label);
    if (missing.length > 0) {
      return fail('missing_inputs', `This workflow needs: ${missing.join(', ')}.`);
    }

    const objective =
      input.values?.['objective'] ??
      template.template.inputs.find((i) => i.name === 'objective')?.defaultValue ??
      template.template.instructions;

    const created = createContext(
      {
        name: input.name?.trim() || `${template.name.replace(/\s*\(template\)$/, '')} run`,
        type: input.type ?? 'ephemeral',
        objective,
        crystallizedFrom: template.id,
      },
      this.#clock,
    );

    // The template's layout is reused; its permission defaults become the
    // starting policy hints. No grants are copied — a new run re-asks.
    const seeded = appendEvent(
      {
        ...created,
        uiSpecification: template.uiSpecification
          ? { ...(template.uiSpecification as Record<string, unknown>), contextId: created.id }
          : null,
        memory: template.memory,
      },
      makeEvent(
        'context.instantiated',
        `Started from template "${template.name}"`,
        { templateContextId: template.id },
        this.#clock,
      ),
      this.#clock,
    );

    const validated = validateContext(seeded);
    if (!validated.ok) return validated;
    await this.#store.put(validated.value);
    return ok(validated.value);
  }

  async delete(id: string): Promise<Result<boolean>> {
    return ok(await this.#store.delete(id));
  }

  // --- internals -----------------------------------------------------------

  #applyTransition(context: Context, next: ContextStatus): Result<Context> {
    const result = transition(context.status, next, context.type);
    if (!result.ok) return result;
    if (result.value.status === context.status) return ok(context);

    const summary = result.value.autoArchived
      ? `Completed and archived (ephemeral context)`
      : `Status ${context.status} → ${result.value.status}`;

    return ok(
      appendEvent(
        { ...context, status: result.value.status },
        makeEvent('context.status-changed', summary, undefined, this.#clock),
        this.#clock,
      ),
    );
  }

  async #save(context: Context): Promise<Result<Context>> {
    const next = { ...context, updatedAt: this.#clock.isoNow() };
    const validated = validateContext(next);
    if (!validated.ok) return validated;
    await this.#store.put(validated.value);
    return ok(validated.value);
  }
}
