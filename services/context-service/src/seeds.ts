import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import {
  CONTEXT_SCHEMA_VERSION,
  type Context,
  type ContextEvent,
  type EventKind,
} from '@sairios/context-schema';
import { seededId } from '@sairios/shared';

/**
 * Three deterministic demo contexts, one per context type.
 *
 * They exist so that a fresh install shows the product thesis immediately
 * rather than an empty screen, and so that the end-to-end test has stable
 * fixtures. Identifiers and timestamps are deterministic: seeding twice
 * produces byte-identical contexts.
 */

const BASE_TIME = Date.UTC(2026, 6, 28, 9, 0, 0);

function at(minutes: number): string {
  return new Date(BASE_TIME + minutes * 60_000).toISOString();
}

function event(seed: string, kind: EventKind, minutes: number, summary: string): ContextEvent {
  return { id: seededId('evt', seed), kind, at: at(minutes), summary };
}

// --- 1. ephemeral ----------------------------------------------------------

const VENDOR_ID = seededId('ctx', 'demo:vendor-proposals');

const vendorUi: SairiUIDocument = {
  version: '0.1',
  contextId: VENDOR_ID,
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
            title: 'Proposal comparison',
            caption: 'Figures transcribed from the three submitted documents.',
            columns: [
              { key: 'criterion', label: 'Criterion' },
              { key: 'northgate', label: 'Northgate' },
              { key: 'lumen', label: 'Lumen Systems' },
              { key: 'arroyo', label: 'Arroyo Labs' },
            ],
            rows: [
              {
                criterion: 'Fixed price (EUR)',
                northgate: '148,000',
                lumen: '121,500',
                arroyo: '167,200',
              },
              {
                criterion: 'Delivery',
                northgate: '14 weeks',
                lumen: '22 weeks',
                arroyo: '11 weeks',
              },
              {
                criterion: 'Support window',
                northgate: '24 months',
                lumen: '12 months',
                arroyo: '36 months',
              },
              { criterion: 'On-premise option', northgate: true, lumen: false, arroyo: true },
              { criterion: 'References checked', northgate: 3, lumen: 1, arroyo: 2 },
            ],
          },
        },
      },
      {
        id: 'criteria',
        width: 'one-third',
        component: {
          type: 'checklist',
          binding: 'proposals.criteria',
          props: {
            title: 'Decision criteria',
            items: [
              { id: 'price', label: 'Total cost within budget', checked: true },
              { id: 'delivery', label: 'Delivery before Q4', checked: true },
              {
                id: 'support',
                label: 'Support beyond 24 months',
                checked: false,
                note: 'Only Arroyo qualifies.',
              },
              { id: 'onprem', label: 'On-premise deployment possible', checked: true },
              { id: 'refs', label: 'At least two references verified', checked: false },
            ],
          },
        },
      },
      {
        id: 'recommendation',
        width: 'two-thirds',
        component: {
          type: 'markdown',
          binding: 'proposals.recommendation',
          props: {
            title: 'Recommendation',
            source:
              '**Northgate** balances the three criteria that carry weight here: it lands inside budget, ' +
              'delivers before Q4, and is the only bid with three verified references.\n\n' +
              'Arroyo is faster and supports longer, but is 13% over budget. Lumen is cheapest and ' +
              'clears nothing else: 22 weeks misses the deadline and only one reference came back.\n\n' +
              'Open question: whether the 36-month support window is worth the Arroyo premium.',
          },
        },
      },
      {
        id: 'sources',
        width: 'one-third',
        component: {
          type: 'source-list',
          binding: 'proposals.sources',
          props: {
            title: 'Source files',
            sources: [
              { label: 'northgate-proposal.pdf', kind: 'file', detail: '18 pages', trusted: true },
              { label: 'lumen-proposal.pdf', kind: 'file', detail: '11 pages', trusted: true },
              { label: 'arroyo-proposal.pdf', kind: 'file', detail: '24 pages', trusted: true },
              { label: 'Reference call notes', kind: 'note', detail: 'Three calls, 2026-07-24' },
            ],
          },
        },
      },
    ],
  },
  suggestedActions: [
    {
      id: 'export.summary',
      label: 'Write summary to sandbox',
      kind: 'system',
      capability: 'files.write',
      description: 'Save the recommendation as a file in this context’s sandbox.',
    },
    {
      id: 'mark.complete',
      label: 'Mark comparison complete',
      kind: 'context',
      description: 'Completing an ephemeral context archives it.',
    },
    {
      id: 'crystallize',
      label: 'Crystallize this workflow',
      kind: 'context',
      description: 'Turn vendor comparison into a reusable template.',
    },
  ],
};

// --- 2. persistent ---------------------------------------------------------

const DEV_ID = seededId('ctx', 'demo:sairios-development');

const devUi: SairiUIDocument = {
  version: '0.1',
  contextId: DEV_ID,
  title: 'SairiOS development',
  contextType: 'persistent',
  layout: {
    type: 'workspace',
    regions: [
      {
        id: 'status',
        width: 'one-third',
        component: {
          type: 'status-panel',
          binding: 'project.status',
          props: {
            title: 'Milestone 0',
            items: [
              {
                label: 'Context domain model',
                state: 'ok',
                detail: 'Schema, lifecycle, crystallization',
              },
              { label: 'SairiUI protocol', state: 'ok', detail: '16-component catalog, validated' },
              { label: 'Permission broker', state: 'ok', detail: 'Observe / propose / execute' },
              { label: 'Desktop shell', state: 'ok', detail: 'React, mock mode' },
              { label: 'OpenClaw provider', state: 'pending', detail: 'Scaffolded, not connected' },
              { label: 'VM image', state: 'warn', detail: 'Scripts written, never booted' },
            ],
          },
        },
      },
      {
        id: 'tasks',
        width: 'one-third',
        component: {
          type: 'checklist',
          binding: 'project.tasks',
          props: {
            title: 'Next up',
            items: [
              { id: 'boot', label: 'Boot the VM image end to end', checked: false },
              { id: 'openclaw', label: 'Connect the OpenClaw gateway', checked: false },
              { id: 'tauri', label: 'Evaluate the Tauri packaging path', checked: false },
              { id: 'sync', label: 'Prototype context sync between two devices', checked: false },
            ],
          },
        },
      },
      {
        id: 'metadata',
        width: 'one-third',
        component: {
          type: 'context-metadata',
          props: { title: 'This context', showObjective: true },
        },
      },
      {
        id: 'decisions',
        width: 'one-half',
        component: {
          type: 'key-value-list',
          binding: 'project.decisions',
          props: {
            title: 'Decisions on record',
            items: [
              { key: 'ADR-0001', value: 'Debian 12 base image, not a kernel fork' },
              { key: 'ADR-0003', value: 'Declarative SairiUI; the model never returns code' },
              { key: 'ADR-0004', value: 'OpenClaw stays behind the agent bridge' },
              { key: 'ADR-0006', value: 'Every privileged action goes through the broker' },
            ],
          },
        },
      },
      {
        id: 'files',
        width: 'one-half',
        component: {
          type: 'file-list',
          binding: 'project.files',
          props: {
            title: 'Recent files',
            files: [
              {
                name: 'ARCHITECTURE.md',
                relativePath: 'notes/ARCHITECTURE.md',
                byteSize: 14_820,
                mediaType: 'text/markdown',
              },
              {
                name: 'sairi-ui.schema.json',
                relativePath: 'notes/sairi-ui.schema.json',
                byteSize: 11_402,
                mediaType: 'application/json',
              },
              {
                name: 'milestone-0.md',
                relativePath: 'notes/milestone-0.md',
                byteSize: 3_118,
                mediaType: 'text/markdown',
              },
            ],
          },
        },
      },
      {
        id: 'activity',
        width: 'full',
        component: { type: 'activity-log', props: { title: 'Activity', limit: 12 } },
      },
    ],
  },
  suggestedActions: [
    {
      id: 'list.services',
      label: 'Check running services',
      kind: 'system',
      capability: 'process.list',
    },
    { id: 'read.notes', label: 'Read milestone notes', kind: 'system', capability: 'files.read' },
  ],
};

// --- 3. crystallized -------------------------------------------------------

const BRIEFING_ID = seededId('ctx', 'demo:weekly-research-briefing');

const briefingUi: SairiUIDocument = {
  version: '0.1',
  contextId: BRIEFING_ID,
  title: 'Weekly research briefing',
  contextType: 'crystallized',
  layout: {
    type: 'workspace',
    regions: [
      {
        id: 'agenda',
        width: 'one-third',
        component: {
          type: 'checklist',
          binding: 'briefing.agenda',
          props: {
            title: 'Reusable agenda',
            items: [
              { id: 'gather', label: 'Gather sources published this week', checked: false },
              { id: 'filter', label: 'Filter to the three that changed something', checked: false },
              { id: 'draft', label: 'Draft the briefing', checked: false },
              { id: 'review', label: 'Human review before export', checked: false },
              { id: 'export', label: 'Export to the briefing folder', checked: false },
            ],
          },
        },
      },
      {
        id: 'library',
        width: 'one-third',
        component: {
          type: 'source-list',
          binding: 'briefing.library',
          props: {
            title: 'Source library',
            sources: [
              {
                label: 'Standing feed list',
                kind: 'note',
                detail: 'Carried forward between runs',
                trusted: true,
              },
              {
                label: 'Regulatory tracker',
                kind: 'note',
                detail: 'Checked every run',
                trusted: true,
              },
            ],
          },
        },
      },
      {
        id: 'stages',
        width: 'one-third',
        component: {
          type: 'timeline',
          binding: 'briefing.stages',
          props: {
            title: 'Workflow stages',
            entries: [
              { at: 'Stage 1', label: 'Prepare workspace', detail: 'Create the run folder' },
              { at: 'Stage 2', label: 'Collect and summarize' },
              { at: 'Stage 3', label: 'Approval', detail: 'Requires a human decision' },
              { at: 'Stage 4', label: 'Export' },
            ],
          },
        },
      },
      {
        id: 'template',
        width: 'two-thirds',
        component: {
          type: 'editor',
          binding: 'briefing.template',
          props: {
            title: 'Briefing template',
            value:
              '# Weekly research briefing — {{week}}\n\n' +
              '## What changed\n\n- \n\n' +
              '## Why it matters\n\n- \n\n' +
              '## What to watch next week\n\n- \n\n' +
              '## Sources\n\n- \n',
            placeholder: 'The briefing structure carried between runs.',
          },
        },
      },
      {
        id: 'notes',
        width: 'one-third',
        component: {
          type: 'text',
          props: {
            title: 'What this template keeps',
            tone: 'muted',
            body:
              'Layout, component choices, stages, permission defaults, instructions and named inputs. ' +
              'Conversation, files, secrets and execution logs from the original run were removed when ' +
              'this context was crystallized.',
          },
        },
      },
    ],
  },
  suggestedActions: [
    {
      id: 'run.briefing',
      label: 'Start this week’s briefing',
      kind: 'context',
      description: 'Create a new ephemeral context from this template.',
    },
    { id: 'export.briefing', label: 'Export briefing', kind: 'system', capability: 'files.write' },
  ],
};

// --- assembly --------------------------------------------------------------

function baseContext(
  id: string,
  name: string,
  type: Context['type'],
  status: Context['status'],
  objective: string,
  ui: SairiUIDocument,
  events: ContextEvent[],
  extra: Partial<Context> = {},
): Context {
  return {
    id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    name,
    type,
    status,
    createdAt: at(0),
    updatedAt: at(120),
    objective,
    memory: [],
    artifacts: [],
    permissions: [],
    tasks: [],
    events,
    uiSpecification: ui,
    agentSession: { provider: 'mock', sessionId: null, status: 'idle' },
    parentContextId: null,
    crystallizedFrom: null,
    ...extra,
  };
}

export function demoContexts(): Context[] {
  const vendor = baseContext(
    VENDOR_ID,
    'Compare three vendor proposals',
    'ephemeral',
    'active',
    'Decide which of the three submitted proposals to accept, and say why.',
    vendorUi,
    [
      event('demo:vendor:e1', 'context.created', 0, 'Context created as ephemeral'),
      event('demo:vendor:e2', 'intention.submitted', 1, 'Compare three vendor proposals'),
      event('demo:vendor:e3', 'ui.specification-updated', 2, 'Interface updated (4 regions)'),
      event(
        'demo:vendor:e4',
        'permission.requested',
        30,
        'files.read requested to open the proposals',
      ),
      event('demo:vendor:e5', 'permission.decided', 31, 'User chose allow (context)'),
      event('demo:vendor:e6', 'action.executed', 32, 'Read 3 files from the context sandbox'),
    ],
    {
      memory: [
        {
          key: 'budget-ceiling',
          value: '150,000 EUR',
          scope: 'durable',
          sensitive: false,
          updatedAt: at(5),
        },
        {
          key: 'deadline',
          value: 'Delivery before Q4 2026',
          scope: 'durable',
          sensitive: false,
          updatedAt: at(5),
        },
        {
          key: 'call-transcript',
          value: 'Reference call, Northgate, 24 July.',
          scope: 'working',
          sensitive: true,
          updatedAt: at(40),
        },
      ],
      permissions: [
        {
          capability: 'files.read',
          decision: 'allow',
          scope: 'context',
          remembered: true,
          grantedAt: at(31),
          grantedBy: 'user',
          reason: 'Open the three proposal PDFs',
        },
      ],
      tasks: [
        {
          id: seededId('tsk', 'demo:vendor:t1'),
          title: 'Verify Arroyo references',
          status: 'pending',
          createdAt: at(35),
          updatedAt: at(35),
        },
      ],
    },
  );

  const development = baseContext(
    DEV_ID,
    'SairiOS development',
    'persistent',
    'active',
    'Build and maintain SairiOS: the context runtime, the shell and the Linux image.',
    devUi,
    [
      event('demo:dev:e1', 'context.created', 0, 'Context created as persistent'),
      event('demo:dev:e2', 'intention.submitted', 2, 'SairiOS development'),
      event('demo:dev:e3', 'ui.specification-updated', 3, 'Interface updated (6 regions)'),
      event('demo:dev:e4', 'action.executed', 60, 'Listed SairiOS services'),
      event('demo:dev:e5', 'agent.message', 75, 'Summarized milestone 0 status'),
    ],
    {
      memory: [
        {
          key: 'architecture-principle',
          value: 'Every window is a context.',
          scope: 'durable',
          sensitive: false,
          updatedAt: at(10),
        },
        {
          key: 'ui-invariant',
          value: 'The model never returns executable frontend code.',
          scope: 'durable',
          sensitive: false,
          updatedAt: at(10),
        },
      ],
      permissions: [
        {
          capability: 'process.list',
          decision: 'allow',
          scope: 'context',
          remembered: false,
          grantedAt: at(60),
          grantedBy: 'default-policy',
        },
      ],
      tasks: [
        {
          id: seededId('tsk', 'demo:dev:t1'),
          title: 'Boot the VM image end to end',
          status: 'pending',
          createdAt: at(20),
          updatedAt: at(20),
        },
        {
          id: seededId('tsk', 'demo:dev:t2'),
          title: 'Connect the OpenClaw gateway',
          status: 'pending',
          createdAt: at(21),
          updatedAt: at(21),
        },
        {
          id: seededId('tsk', 'demo:dev:t3'),
          title: 'Write the context lifecycle tests',
          status: 'done',
          createdAt: at(22),
          updatedAt: at(90),
        },
      ],
    },
  );

  const briefing = baseContext(
    BRIEFING_ID,
    'Weekly research briefing',
    'crystallized',
    'active',
    'Produce the weekly research briefing: gather sources, summarize what changed, get approval, export.',
    briefingUi,
    [
      event(
        'demo:brief:e1',
        'context.crystallized',
        0,
        'Crystallized from "Research AI regulation"',
      ),
    ],
    {
      memory: [
        {
          key: 'briefing-audience',
          value: 'Editorial team, Monday morning.',
          scope: 'durable',
          sensitive: false,
          updatedAt: at(0),
        },
      ],
      template: {
        instructions:
          'Produce a weekly research briefing. Gather sources published in the last seven days, keep only ' +
          'the items that changed something, and draft against the stored template. Ask for approval before ' +
          'exporting. Do not fetch anything without requesting network.fetch first.',
        inputs: [
          {
            name: 'week',
            label: 'Week of',
            type: 'date',
            required: true,
            description: 'Monday of the week being briefed.',
          },
          {
            name: 'objective',
            label: 'Focus for this run',
            type: 'multiline',
            required: false,
            defaultValue: 'General research briefing.',
          },
          {
            name: 'audience',
            label: 'Audience',
            type: 'choice',
            required: false,
            choices: ['Editorial team', 'Executive', 'Public'],
            defaultValue: 'Editorial team',
          },
        ],
        stages: [
          { id: 'stage_1', title: 'Prepare workspace', requiresApproval: false },
          { id: 'stage_2', title: 'Collect and summarize', requiresApproval: false },
          {
            id: 'stage_3',
            title: 'Approval',
            description: 'A human approves before anything leaves the context.',
            requiresApproval: true,
          },
          { id: 'stage_4', title: 'Export', requiresApproval: false },
        ],
        permissionDefaults: { 'files.write': 'ask', 'network.fetch': 'ask' },
      },
    },
  );

  return [vendor, development, briefing];
}

export const DEMO_CONTEXT_IDS = {
  ephemeral: VENDOR_ID,
  persistent: DEV_ID,
  crystallized: BRIEFING_ID,
} as const;
