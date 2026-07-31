import { newId, ok, type Result, systemClock, type Clock } from '@sairios/shared';
import { isCrystallizable } from './lifecycle.js';
import {
  CONTEXT_SCHEMA_VERSION,
  type Capability,
  type Context,
  type CrystallizedTemplate,
  type MemoryEntry,
  type PolicyDecision,
  type TemplateInput,
  type WorkflowStage,
} from './types.js';

/**
 * Crystallization.
 *
 * "Applications are crystallized contexts." A crystallized context is a
 * stabilized, reusable workflow distilled from a context that has actually run.
 *
 * Crystallization is a SANITIZING operation, not a copy. The sanitizer is
 * allow-list based: a field is carried forward only if it appears here.
 * Anything new added to the Context type is therefore dropped by default,
 * which is the safe direction for a document the user intends to reuse and
 * possibly share.
 */

/** Everything the sanitizer deliberately removes, with a reason the UI can show. */
export interface DiscardedItem {
  category: 'conversation' | 'memory' | 'artifact' | 'execution-log' | 'secret' | 'session';
  label: string;
  reason: string;
}

export interface RetainedItem {
  category: 'layout' | 'component' | 'stage' | 'permission' | 'instruction' | 'input';
  label: string;
}

export interface CrystallizationPreview {
  sourceContextId: string;
  proposedName: string;
  retained: readonly RetainedItem[];
  discarded: readonly DiscardedItem[];
}

/** Memory keys that look like credentials never survive, whatever their scope. */
const SECRET_KEY = /(key|token|secret|password|credential|auth)/i;

/** Event kinds that describe structure rather than content, safe to summarize as stages. */
const STAGE_EVENTS = new Set(['permission.decided', 'action.executed', 'ui.specification-updated']);

export interface CrystallizeOptions {
  name?: string;
  instructions?: string;
  inputs?: readonly TemplateInput[];
  clock?: Clock;
}

/**
 * Produces the user-visible preview of a crystallization without performing it.
 * The shell shows this before asking for confirmation — the user must be able to
 * see what leaves the context and what does not.
 */
export function previewCrystallization(
  context: Context,
  options: CrystallizeOptions = {},
): CrystallizationPreview {
  const retained: RetainedItem[] = [];
  const discarded: DiscardedItem[] = [];

  const layout = extractLayout(context.uiSpecification);
  if (layout) {
    retained.push({ category: 'layout', label: `Layout: ${layout.layoutType}` });
    for (const component of layout.components) {
      if (component === 'permission-request') {
        discarded.push({
          category: 'execution-log',
          label: 'Permission request panel',
          reason:
            'It refers to a request in the original context. A new run raises its own requests.',
        });
        continue;
      }
      retained.push({ category: 'component', label: `Component: ${component}` });
    }
    if (layout.components.length > 0) {
      discarded.push({
        category: 'conversation',
        label: 'Interface contents',
        reason:
          'Table rows, notes, sources and other content belong to this run. The template keeps the ' +
          'layout and starts empty.',
      });
    }
  }

  for (const stage of deriveStages(context)) {
    retained.push({ category: 'stage', label: `Stage: ${stage.title}` });
  }

  for (const [capability, decision] of Object.entries(derivePermissionDefaults(context))) {
    retained.push({ category: 'permission', label: `${capability} → ${decision}` });
  }

  retained.push({
    category: 'instruction',
    label: options.instructions
      ? 'Custom reusable instructions'
      : 'Objective as reusable instructions',
  });

  for (const input of options.inputs ?? deriveInputs(context)) {
    retained.push({ category: 'input', label: `Input: ${input.label}` });
  }

  // --- what is dropped ---------------------------------------------------
  const conversationEvents = context.events.filter(
    (e) => e.kind === 'agent.message' || e.kind === 'intention.submitted',
  );
  if (conversationEvents.length > 0) {
    discarded.push({
      category: 'conversation',
      label: `${conversationEvents.length} conversation entries`,
      reason: 'Private conversation content is never carried into a reusable template.',
    });
  }

  for (const entry of context.memory) {
    const drop = memoryDropReason(entry);
    if (drop) {
      discarded.push({
        category: SECRET_KEY.test(entry.key) ? 'secret' : 'memory',
        label: `Memory: ${entry.key}`,
        reason: drop,
      });
    }
  }

  if (context.artifacts.length > 0) {
    discarded.push({
      category: 'artifact',
      label: `${context.artifacts.length} files`,
      reason: 'Files belong to the original context. A template starts with an empty workspace.',
    });
  }

  const logEvents = context.events.length - conversationEvents.length;
  if (logEvents > 0) {
    discarded.push({
      category: 'execution-log',
      label: `${logEvents} execution log entries`,
      reason: 'Transient execution history describes one run, not the workflow.',
    });
  }

  if (context.agentSession.sessionId) {
    discarded.push({
      category: 'session',
      label: 'Agent session',
      reason: 'A template has no live agent session; instantiating one creates a fresh session.',
    });
  }

  return {
    sourceContextId: context.id,
    proposedName: options.name ?? `${context.name} (template)`,
    retained,
    discarded,
  };
}

function memoryDropReason(entry: MemoryEntry): string | undefined {
  if (SECRET_KEY.test(entry.key)) {
    return 'Key name suggests a credential. Secrets never enter a template.';
  }
  if (entry.sensitive) {
    return 'Marked sensitive: derived from untrusted or private content.';
  }
  if (entry.scope !== 'durable') {
    return `Scope "${entry.scope}" is run-specific and does not describe the workflow.`;
  }
  return undefined;
}

function extractLayout(spec: unknown): { layoutType: string; components: string[] } | undefined {
  if (typeof spec !== 'object' || spec === null) return undefined;
  const layout = (spec as { layout?: unknown }).layout;
  if (typeof layout !== 'object' || layout === null) return undefined;
  const layoutType = String((layout as { type?: unknown }).type ?? 'workspace');
  const regions = (layout as { regions?: unknown }).regions;
  const components: string[] = [];
  if (Array.isArray(regions)) {
    for (const region of regions) {
      const component = (region as { component?: { type?: unknown } }).component;
      if (component && typeof component.type === 'string') components.push(component.type);
    }
  }
  return { layoutType, components };
}

/**
 * Derives workflow stages. Prefers explicit stages from a source template;
 * otherwise reconstructs them from the shape of the execution history — the
 * *sequence* of approvals and actions, never their content.
 */
function deriveStages(context: Context): WorkflowStage[] {
  if (context.template?.stages.length) return [...context.template.stages];

  const stages: WorkflowStage[] = [];
  const seen = new Set<string>();
  for (const event of context.events) {
    if (!STAGE_EVENTS.has(event.kind)) continue;
    const title = stageTitleFor(event.kind);
    if (seen.has(title)) continue;
    seen.add(title);
    stages.push({
      id: `stage_${stages.length + 1}`,
      title,
      requiresApproval: event.kind === 'permission.decided',
    });
  }

  if (stages.length === 0) {
    stages.push({ id: 'stage_1', title: 'Run workflow', requiresApproval: false });
  }
  return stages;
}

function stageTitleFor(kind: string): string {
  switch (kind) {
    case 'permission.decided':
      return 'Approval';
    case 'action.executed':
      return 'Execution';
    default:
      return 'Prepare workspace';
  }
}

/**
 * Permission defaults carried into the template. Only decisions the user
 * actually made for the whole context survive, and `allow` is downgraded to
 * `ask` — a template must never silently pre-authorize a capability in a new
 * context with new data.
 */
function derivePermissionDefaults(context: Context): Partial<Record<Capability, PolicyDecision>> {
  if (context.template?.permissionDefaults) return { ...context.template.permissionDefaults };
  const defaults: Partial<Record<Capability, PolicyDecision>> = {};
  for (const grant of context.permissions) {
    if (grant.scope !== 'context') continue;
    defaults[grant.capability] = grant.decision === 'allow' ? 'ask' : grant.decision;
  }
  return defaults;
}

/** A template asks for the things the original context hard-coded. */
function deriveInputs(context: Context): TemplateInput[] {
  if (context.template?.inputs.length) return [...context.template.inputs];
  return [
    {
      name: 'objective',
      label: 'Objective for this run',
      type: 'multiline',
      required: true,
      defaultValue: context.objective,
      description: 'What this run of the workflow should accomplish.',
    },
  ];
}

/**
 * Performs crystallization. Returns a brand new `crystallized` context; the
 * source context is never mutated.
 */
export function crystallize(
  context: Context,
  options: CrystallizeOptions = {},
): Result<{ context: Context; preview: CrystallizationPreview }> {
  const guard = isCrystallizable(context);
  if (!guard.ok) return guard;

  const clock = options.clock ?? systemClock;
  const preview = previewCrystallization(context, options);
  const now = clock.isoNow();

  const template: CrystallizedTemplate = {
    instructions: (options.instructions ?? context.objective).trim(),
    inputs: options.inputs ?? deriveInputs(context),
    stages: deriveStages(context),
    permissionDefaults: derivePermissionDefaults(context),
  };

  // Allow-list: only durable, non-sensitive, non-secret memory survives.
  const memory = context.memory.filter((entry) => memoryDropReason(entry) === undefined);

  const crystallized: Context = {
    id: newId('ctx'),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    name: preview.proposedName,
    type: 'crystallized',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    objective: template.instructions,
    memory,
    // Deliberately empty: files, history and session belong to the original run.
    artifacts: [],
    permissions: [],
    tasks: [],
    events: [
      {
        id: newId('evt'),
        kind: 'context.crystallized',
        at: now,
        summary: `Crystallized from "${context.name}"`,
        data: {
          sourceContextId: context.id,
          retainedCount: preview.retained.length,
          discardedCount: preview.discarded.length,
        },
      },
    ],
    uiSpecification: sanitizeUiSpecification(context.uiSpecification),
    agentSession: { provider: context.agentSession.provider, sessionId: null, status: 'idle' },
    parentContextId: context.id,
    crystallizedFrom: null,
    template,
  };

  return ok({ context: crystallized, preview });
}

/**
 * Per-component prop sanitization.
 *
 * A component's props mix two different things: STRUCTURE (which columns a
 * table has, what an editor is for, which capability a button needs) and
 * CONTENT (the rows, the notes, the fetched sources). A template keeps the
 * structure and drops the content, because the content is one run's data.
 *
 * `keep` lists the structural props carried forward. `reset` gives the empty
 * value for each content prop, so the sanitized document still satisfies the
 * SairiUI schema instead of failing validation with a missing required field.
 *
 * A component type absent from this table has its region dropped entirely.
 * Default-drop is the safe direction: a component added to the catalog without
 * a considered entry here cannot leak a previous run into a shared template.
 */
const PROP_POLICY: Record<string, { keep: readonly string[]; reset: Record<string, unknown> }> = {
  text: { keep: ['title', 'tone'], reset: { body: '' } },
  markdown: { keep: ['title'], reset: { source: '' } },
  'source-list': { keep: ['title'], reset: { sources: [] } },
  'key-value-list': { keep: ['title'], reset: { items: [] } },
  editor: { keep: ['title', 'placeholder', 'readOnly'], reset: { value: '' } },
  table: { keep: ['title', 'caption', 'columns'], reset: { rows: [] } },
  // Checklist items are the workflow steps, so they are structure. Their ticked
  // state and per-run notes are not.
  checklist: { keep: ['title'], reset: {} },
  timeline: { keep: ['title'], reset: { entries: [] } },
  progress: { keep: ['title', 'label', 'indeterminate'], reset: { value: 0 } },
  'status-panel': { keep: ['title'], reset: { items: [] } },
  'action-button': {
    keep: ['label', 'actionId', 'description', 'capability', 'variant'],
    reset: {},
  },
  'terminal-output': { keep: ['title'], reset: { lines: [] } },
  'file-list': { keep: ['title'], reset: { files: [] } },
  // Host-rendered: their content comes from the new context, never the old one.
  'context-metadata': { keep: ['title', 'showObjective'], reset: {} },
  'activity-log': { keep: ['title', 'limit'], reset: {} },
  // `permission-request` is deliberately absent: its requestId refers to a
  // request in the ORIGINAL context. Carrying it forward would render a prompt
  // the broker cannot verify, so the region is dropped instead.
};

function sanitizeChecklistItems(props: Record<string, unknown>): unknown {
  const items = props['items'];
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const i = item as Record<string, unknown>;
    // id and label describe the step; checked and note describe one run.
    return { id: i['id'], label: i['label'], checked: false };
  });
}

/**
 * Keeps the layout skeleton — regions, component types, structural props and
 * bindings — and drops the content the original run accumulated.
 *
 * Returns null when nothing renderable survives, which is preferable to
 * emitting an empty layout the schema would reject.
 */
export function sanitizeUiSpecification(spec: unknown): unknown | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return null;
  const source = spec as Record<string, unknown>;
  const layout = source['layout'];
  if (typeof layout !== 'object' || layout === null) return null;

  const regions = (layout as { regions?: unknown }).regions;
  const cleanRegions: Record<string, unknown>[] = [];

  if (Array.isArray(regions)) {
    for (const region of regions) {
      const r = region as Record<string, unknown>;
      const component = (r['component'] ?? {}) as Record<string, unknown>;
      const type = component['type'];
      if (typeof type !== 'string') continue;

      const policy = PROP_POLICY[type];
      if (!policy) continue; // default-drop, including permission-request

      const sourceProps = (component['props'] ?? {}) as Record<string, unknown>;
      const props: Record<string, unknown> = {};
      for (const key of policy.keep) {
        if (sourceProps[key] !== undefined) props[key] = sourceProps[key];
      }
      for (const [key, empty] of Object.entries(policy.reset)) {
        props[key] = empty;
      }
      if (type === 'checklist') props['items'] = sanitizeChecklistItems(sourceProps);

      const cleanComponent: Record<string, unknown> = { type, props };
      if (typeof component['binding'] === 'string')
        cleanComponent['binding'] = component['binding'];

      const clean: Record<string, unknown> = { id: r['id'], component: cleanComponent };
      if (r['width'] !== undefined) clean['width'] = r['width'];
      cleanRegions.push(clean);
    }
  }

  if (cleanRegions.length === 0) return null;

  return {
    version: source['version'] ?? '0.1',
    contextId: null,
    title: source['title'] ?? 'Untitled template',
    contextType: 'crystallized',
    layout: { type: (layout as { type?: unknown }).type ?? 'workspace', regions: cleanRegions },
    suggestedActions: [],
  };
}
