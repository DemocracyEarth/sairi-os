import { createHash } from 'node:crypto';
import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import { ok, seededId, type Result } from '@sairios/shared';
import type { AgentEvent, AgentProvider, IntentionInput, ProviderStatus } from '../provider.js';

/**
 * The mock agent provider.
 *
 * Deterministic, offline, and requires no credentials of any kind. This is not
 * a stub to be replaced: mock mode is a first-class supported mode. Every test
 * runs against it, `make dev` uses it by default, and the VM boots into it.
 *
 * The planner below is intentionally simple keyword matching. It is a stand-in
 * for a model, not an attempt to be one.
 */

type Plan = 'comparison' | 'research' | 'project' | 'workflow' | 'generic';

function planFor(intention: string): Plan {
  const text = intention.toLowerCase();
  if (/\b(compar|versus|vs\.?|evaluate|proposal|quote|bid|option)/.test(text)) return 'comparison';
  if (/\b(research|investigat|study|read|source|paper|brief)/.test(text)) return 'research';
  if (/\b(project|develop|build|ship|milestone|release|backlog)/.test(text)) return 'project';
  if (/\b(weekly|recurring|every|checklist|workflow|routine|process)/.test(text)) return 'workflow';
  return 'generic';
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function buildDocument(input: IntentionInput, plan: Plan): SairiUIDocument {
  const title = truncate(input.intention.trim() || input.contextName, 200);
  const base = {
    version: '0.1' as const,
    contextId: input.contextId,
    title,
    contextType: input.contextType,
  };

  switch (plan) {
    case 'comparison':
      return {
        ...base,
        layout: {
          type: 'workspace',
          regions: [
            {
              id: 'comparison',
              width: 'two-thirds',
              component: {
                type: 'table',
                binding: 'comparison.options',
                props: {
                  title: 'Comparison',
                  caption: 'Populated as the options are read. Empty until sources are provided.',
                  columns: [
                    { key: 'criterion', label: 'Criterion' },
                    { key: 'optionA', label: 'Option A' },
                    { key: 'optionB', label: 'Option B' },
                    { key: 'optionC', label: 'Option C' },
                  ],
                  rows: [],
                },
              },
            },
            {
              id: 'criteria',
              width: 'one-third',
              component: {
                type: 'checklist',
                binding: 'comparison.criteria',
                props: {
                  title: 'Criteria',
                  items: [
                    { id: 'cost', label: 'Cost', checked: false },
                    { id: 'time', label: 'Time to deliver', checked: false },
                    { id: 'risk', label: 'Risk', checked: false },
                  ],
                },
              },
            },
            {
              id: 'sources',
              width: 'one-third',
              component: { type: 'source-list', props: { title: 'Sources', sources: [] } },
            },
            {
              id: 'recommendation',
              width: 'two-thirds',
              component: {
                type: 'markdown',
                props: {
                  title: 'Recommendation',
                  source: 'No recommendation yet. Add the options you want compared.',
                },
              },
            },
          ],
        },
        suggestedActions: [
          {
            id: 'add.sources',
            label: 'Read source files',
            kind: 'system',
            capability: 'files.read',
          },
          { id: 'mark.complete', label: 'Mark complete', kind: 'context' },
        ],
      };

    case 'research':
      return {
        ...base,
        layout: {
          type: 'workspace',
          regions: [
            {
              id: 'sources',
              width: 'one-third',
              component: {
                type: 'source-list',
                binding: 'research.sources',
                props: { title: 'Sources', sources: [] },
              },
            },
            {
              id: 'notes',
              width: 'two-thirds',
              component: {
                type: 'editor',
                binding: 'research.notes',
                props: {
                  title: 'Working notes',
                  value: `# ${title}\n\n## What I know\n\n## What I need to find out\n\n## Open questions\n`,
                  placeholder: 'Notes accumulate here as the investigation proceeds.',
                },
              },
            },
            {
              id: 'progress',
              width: 'full',
              component: {
                type: 'progress',
                props: { title: 'Investigation', label: 'Gathering sources', value: 0.1 },
              },
            },
          ],
        },
        suggestedActions: [
          {
            id: 'fetch.sources',
            label: 'Fetch a source',
            kind: 'system',
            capability: 'network.fetch',
          },
          { id: 'crystallize', label: 'Crystallize this workflow', kind: 'context' },
        ],
      };

    case 'project':
      return {
        ...base,
        layout: {
          type: 'workspace',
          regions: [
            {
              id: 'status',
              width: 'one-third',
              component: {
                type: 'status-panel',
                props: {
                  title: 'Status',
                  items: [{ label: 'Context created', state: 'ok', detail: 'Ready for work' }],
                },
              },
            },
            {
              id: 'tasks',
              width: 'one-third',
              component: { type: 'checklist', props: { title: 'Tasks', items: [] } },
            },
            {
              id: 'meta',
              width: 'one-third',
              component: {
                type: 'context-metadata',
                props: { title: 'Context', showObjective: true },
              },
            },
            {
              id: 'activity',
              width: 'full',
              component: { type: 'activity-log', props: { title: 'Activity', limit: 15 } },
            },
          ],
        },
        suggestedActions: [
          {
            id: 'list.services',
            label: 'Check services',
            kind: 'system',
            capability: 'process.list',
          },
        ],
      };

    case 'workflow':
      return {
        ...base,
        layout: {
          type: 'workspace',
          regions: [
            {
              id: 'stages',
              width: 'one-half',
              component: {
                type: 'timeline',
                props: {
                  title: 'Stages',
                  entries: [
                    { at: 'Stage 1', label: 'Prepare' },
                    { at: 'Stage 2', label: 'Work' },
                    { at: 'Stage 3', label: 'Approval', detail: 'Requires a human decision' },
                    { at: 'Stage 4', label: 'Export' },
                  ],
                },
              },
            },
            {
              id: 'steps',
              width: 'one-half',
              component: {
                type: 'checklist',
                props: {
                  title: 'Steps',
                  items: [
                    { id: 'prepare', label: 'Prepare the workspace', checked: false },
                    { id: 'work', label: 'Do the work', checked: false },
                    { id: 'approve', label: 'Get approval', checked: false },
                    { id: 'export', label: 'Export the result', checked: false },
                  ],
                },
              },
            },
            {
              id: 'note',
              width: 'full',
              component: {
                type: 'text',
                props: {
                  title: 'Recurring work',
                  tone: 'muted',
                  body: 'Once this has run a few times, crystallize it into a reusable template.',
                },
              },
            },
          ],
        },
        suggestedActions: [
          { id: 'crystallize', label: 'Crystallize this workflow', kind: 'context' },
        ],
      };

    default:
      return {
        ...base,
        layout: {
          type: 'stack',
          regions: [
            {
              id: 'objective',
              width: 'full',
              component: {
                type: 'text',
                props: {
                  title: 'Objective',
                  body: input.intention.trim() || 'No objective recorded yet.',
                },
              },
            },
            {
              id: 'notes',
              width: 'full',
              component: {
                type: 'editor',
                props: { title: 'Working notes', value: '', placeholder: 'Start here.' },
              },
            },
            {
              id: 'meta',
              width: 'full',
              component: {
                type: 'context-metadata',
                props: { title: 'Context', showObjective: false },
              },
            },
          ],
        },
        suggestedActions: [{ id: 'mark.complete', label: 'Mark complete', kind: 'context' }],
      };
  }
}

/**
 * Which mock agent this instance is.
 *
 * The relay needs two agents that are actually distinguishable, and the only
 * way to have that with no credentials, no network and no external process
 * (invariant 6) is for the mock to be able to be more than one thing.
 *
 * `analyst` writes a brief and offers to hand it on. `editor` takes a brief it
 * has been handed and reads it. Between them they are the smallest complete
 * demonstration of the loop this product exists to automate.
 */
export type MockAgentRole = 'generalist' | 'analyst' | 'editor';

export interface MockProviderOptions {
  /** Milliseconds between streamed events. Zero in tests. */
  stepDelayMs?: number;
  /**
   * The agent this instance stands for. Defaults to the original single-agent
   * behaviour, so every existing caller and test is unaffected.
   */
  role?: MockAgentRole;
}

/** The artifact the analyst writes and the editor is handed. */
const BRIEF_PATH = 'brief.md';
const BRIEF_BODY = 'Three vendors quoted. The median is the number that matters.\n';

export class MockAgentProvider implements AgentProvider {
  readonly name: string;
  readonly #role: MockAgentRole;
  readonly #sessions = new Set<string>();
  readonly #delay: number;

  constructor(options: MockProviderOptions = {}) {
    this.#delay = options.stepDelayMs ?? 0;
    this.#role = options.role ?? 'generalist';
    // `mock` for the original, `mock.analyst` / `mock.editor` for the pair —
    // and those two strings are exactly the broker's relay roster, so a hop
    // between them resolves rather than being rejected as an unknown agent.
    this.name = this.#role === 'generalist' ? 'mock' : `mock.${this.#role}`;
  }

  async status(): Promise<ProviderStatus> {
    return {
      provider: this.name,
      configured: true,
      offline: true,
      detail: 'Deterministic offline provider. No API key, no network, no external process.',
    };
  }

  async createSession(contextId: string): Promise<Result<string>> {
    // The ROLE is in the seed. Without it two agents working the same context
    // mint the same session id, and the second one silently joins the first.
    const sessionId = seededId('ses', `${this.name}:${contextId}`);
    this.#sessions.add(sessionId);
    return ok(sessionId);
  }

  async *run(sessionId: string, input: IntentionInput): AsyncIterable<AgentEvent> {
    yield { type: 'session', sessionId };
    yield { type: 'status', status: 'thinking' };
    await this.#pause();

    /*
     * The two relay agents run a fixed script rather than reading the
     * intention, because what is being demonstrated is the HOP, not the
     * planner. Each asks for exactly the capabilities its half of the loop
     * needs, and nothing else.
     */
    if (this.#role === 'analyst') {
      yield { type: 'status', status: 'waiting-permission' };
      yield {
        type: 'permission-request',
        capability: 'files.write',
        reason: 'Write the brief this context asked for.',
        payload: { path: BRIEF_PATH, content: BRIEF_BODY },
      };
      await this.#pause();
      yield {
        type: 'permission-request',
        capability: 'agent.relay',
        reason: 'Hand the finished brief to the editor.',
        payload: {
          from: 'mock.analyst',
          to: 'mock.editor',
          path: BRIEF_PATH,
          sha256: createHash('sha256').update(BRIEF_BODY, 'utf8').digest('hex'),
          bytes: Buffer.byteLength(BRIEF_BODY, 'utf8'),
        },
      };
      await this.#pause();
      yield { type: 'done' };
      return;
    }

    if (this.#role === 'editor') {
      yield { type: 'status', status: 'waiting-permission' };
      yield {
        type: 'permission-request',
        capability: 'files.read',
        reason: 'Read the brief that was handed over.',
        payload: { path: BRIEF_PATH },
      };
      await this.#pause();
      yield { type: 'done' };
      return;
    }

    const plan = planFor(input.intention);
    yield {
      type: 'message',
      text: `Reading the intention as a ${plan} context and laying out an interface for it.`,
    };
    await this.#pause();

    // A comparison plan needs the source files, so it asks. This is what makes
    // the permission flow demonstrable without any real capability being used.
    if (plan === 'comparison' || plan === 'research') {
      yield { type: 'status', status: 'waiting-permission' };
      yield {
        type: 'permission-request',
        capability: plan === 'comparison' ? 'files.read' : 'network.fetch',
        reason:
          plan === 'comparison'
            ? 'Read the documents you want compared from this context’s sandbox.'
            : 'Retrieve a source you named so it can be summarized.',
        payload:
          plan === 'comparison'
            ? { path: 'proposals/README.md' }
            : { url: 'https://example.org/source' },
      };
      await this.#pause();
    }

    yield { type: 'status', status: 'streaming' };
    yield { type: 'ui', document: buildDocument(input, plan) };
    await this.#pause();

    yield { type: 'status', status: 'idle' };
    yield { type: 'done' };
  }

  async closeSession(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }

  async #pause(): Promise<void> {
    if (this.#delay > 0) await new Promise((resolve) => setTimeout(resolve, this.#delay));
  }
}
