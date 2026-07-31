import type { ComponentType } from './types.js';

/**
 * The audited component catalog.
 *
 * Adding an entry here is a security decision, not a UI decision: it widens what
 * an agent is able to put on the user's screen. Every entry records where its
 * content comes from, which is the property that matters when reasoning about
 * prompt injection.
 */
export interface CatalogEntry {
  type: ComponentType;
  label: string;
  summary: string;
  /**
   * `model`  — content comes from the (untrusted) model payload.
   * `host`   — content comes from SairiOS state; the model only asks for the view.
   * `broker` — content is cross-checked against the permission broker before display.
   */
  contentSource: 'model' | 'host' | 'broker';
  /** True when the component can produce user input or trigger a request. */
  interactive: boolean;
  notes?: string;
}

export const COMPONENT_CATALOG: Readonly<Record<ComponentType, CatalogEntry>> = {
  text: {
    type: 'text',
    label: 'Text',
    summary: 'A short block of plain prose.',
    contentSource: 'model',
    interactive: false,
  },
  markdown: {
    type: 'markdown',
    label: 'Markdown',
    summary: 'Formatted prose in a restricted markdown subset.',
    contentSource: 'model',
    interactive: false,
    notes: 'Renderer strips raw HTML, scripts, remote images and non-http(s) link schemes.',
  },
  'source-list': {
    type: 'source-list',
    label: 'Source list',
    summary: 'References the context is working from.',
    contentSource: 'model',
    interactive: false,
    notes: 'Sources are marked untrusted unless explicitly flagged trusted.',
  },
  'key-value-list': {
    type: 'key-value-list',
    label: 'Key-value list',
    summary: 'Compact labelled facts.',
    contentSource: 'model',
    interactive: false,
  },
  editor: {
    type: 'editor',
    label: 'Editable document',
    summary: 'A working document the user can edit.',
    contentSource: 'model',
    interactive: true,
  },
  table: {
    type: 'table',
    label: 'Table',
    summary: 'Structured comparison of rows against columns.',
    contentSource: 'model',
    interactive: false,
  },
  checklist: {
    type: 'checklist',
    label: 'Checklist',
    summary: 'Steps or criteria the user can tick off.',
    contentSource: 'model',
    interactive: true,
  },
  timeline: {
    type: 'timeline',
    label: 'Timeline',
    summary: 'Ordered entries with timestamps.',
    contentSource: 'model',
    interactive: false,
  },
  progress: {
    type: 'progress',
    label: 'Progress indicator',
    summary: 'Completion of a bounded operation.',
    contentSource: 'model',
    interactive: false,
  },
  'status-panel': {
    type: 'status-panel',
    label: 'Status panel',
    summary: 'Explicit system state, one line per subsystem.',
    contentSource: 'model',
    interactive: false,
  },
  'permission-request': {
    type: 'permission-request',
    label: 'Permission request',
    summary: 'A capability the agent wants, with reason and risk.',
    contentSource: 'broker',
    interactive: true,
    notes:
      'The renderer resolves requestId against the permission broker. A request the broker does not know about renders as an error, never as an approvable prompt.',
  },
  'action-button': {
    type: 'action-button',
    label: 'Action button',
    summary: 'A single proposed action the user may run.',
    contentSource: 'model',
    interactive: true,
    notes: 'actionId is opaque. Execution still passes through the permission broker.',
  },
  'terminal-output': {
    type: 'terminal-output',
    label: 'Terminal output',
    summary: 'Read-only output from a completed sandboxed action.',
    contentSource: 'model',
    interactive: false,
    notes: 'Display only. There is no input channel and no shell attached.',
  },
  'file-list': {
    type: 'file-list',
    label: 'File list',
    summary: 'Files in the context sandbox.',
    contentSource: 'model',
    interactive: false,
  },
  'context-metadata': {
    type: 'context-metadata',
    label: 'Context metadata',
    summary: 'Name, type, status and timestamps of this context.',
    contentSource: 'host',
    interactive: false,
  },
  'activity-log': {
    type: 'activity-log',
    label: 'Activity log',
    summary: 'What has happened in this context.',
    contentSource: 'host',
    interactive: false,
  },
};

export function catalogEntry(type: ComponentType): CatalogEntry {
  return COMPONENT_CATALOG[type];
}
