/**
 * SairiUI — the declarative adaptive-UI protocol.
 *
 * The model NEVER returns executable frontend code. It returns a SairiUI
 * document: a versioned, schema-validated description drawn from a small
 * audited component catalog. The renderer is the only thing that turns that
 * description into DOM, and it can only render components it already knows.
 *
 * This is the difference between "the agent designs the interface" and
 * "the agent can run arbitrary code in your shell".
 */

export const SAIRI_UI_VERSION = '0.1' as const;

/** The complete v0 component catalog. Anything not in this list is rejected. */
export const COMPONENT_TYPES = [
  'text',
  'markdown',
  'source-list',
  'key-value-list',
  'editor',
  'table',
  'checklist',
  'timeline',
  'progress',
  'status-panel',
  'permission-request',
  'action-button',
  'terminal-output',
  'file-list',
  'context-metadata',
  'activity-log',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const REGION_WIDTHS = [
  'full',
  'one-half',
  'one-third',
  'two-thirds',
  'one-quarter',
  'three-quarters',
] as const;
export type RegionWidth = (typeof REGION_WIDTHS)[number];

export const LAYOUT_TYPES = ['workspace', 'stack', 'split'] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];

// --- component prop shapes -------------------------------------------------

export type Tone = 'normal' | 'muted' | 'warning';
export type StatusState = 'ok' | 'warn' | 'error' | 'pending' | 'idle';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface TextProps {
  title?: string;
  body: string;
  tone?: Tone;
}

export interface MarkdownProps {
  title?: string;
  /** Rendered by a restricted markdown subset — no HTML, no scripts, no images. */
  source: string;
}

export interface SourceItem {
  label: string;
  kind: 'file' | 'url' | 'note';
  detail?: string;
  /** False (the default) marks content the agent fetched or the user did not author. */
  trusted?: boolean;
}
export interface SourceListProps {
  title?: string;
  sources: SourceItem[];
}

export interface KeyValueListProps {
  title?: string;
  items: { key: string; value: string }[];
}

export interface EditorProps {
  title?: string;
  value: string;
  placeholder?: string;
  readOnly?: boolean;
}

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}
export interface TableProps {
  title?: string;
  columns: TableColumn[];
  rows: Record<string, string | number | boolean | null>[];
  caption?: string;
}

export interface ChecklistProps {
  title?: string;
  items: { id: string; label: string; checked: boolean; note?: string }[];
}

export interface TimelineProps {
  title?: string;
  entries: { at: string; label: string; detail?: string }[];
}

export interface ProgressProps {
  title?: string;
  label?: string;
  /** 0..1. Ignored when `indeterminate` is true. */
  value: number;
  indeterminate?: boolean;
}

export interface StatusPanelProps {
  title?: string;
  items: { label: string; state: StatusState; detail?: string }[];
}

export interface PermissionRequestProps {
  title?: string;
  capability: string;
  reason: string;
  risk: RiskLevel;
  /** Correlates with a pending request in the permission broker. */
  requestId: string;
}

export interface ActionButtonProps {
  label: string;
  /** Opaque id the shell hands back to the agent bridge. Never a command line. */
  actionId: string;
  description?: string;
  capability?: string;
  variant?: 'primary' | 'default' | 'danger';
}

export interface TerminalOutputProps {
  title?: string;
  lines: string[];
  exitCode?: number;
}

export interface FileListProps {
  title?: string;
  files: {
    name: string;
    relativePath: string;
    byteSize?: number;
    mediaType?: string;
    untrusted?: boolean;
  }[];
}

/** Host-rendered: content comes from the context record, not from the model. */
export interface ContextMetadataProps {
  title?: string;
  showObjective?: boolean;
}

/** Host-rendered: content comes from the context event log, not from the model. */
export interface ActivityLogProps {
  title?: string;
  limit?: number;
}

export interface ComponentPropsByType {
  text: TextProps;
  markdown: MarkdownProps;
  'source-list': SourceListProps;
  'key-value-list': KeyValueListProps;
  editor: EditorProps;
  table: TableProps;
  checklist: ChecklistProps;
  timeline: TimelineProps;
  progress: ProgressProps;
  'status-panel': StatusPanelProps;
  'permission-request': PermissionRequestProps;
  'action-button': ActionButtonProps;
  'terminal-output': TerminalOutputProps;
  'file-list': FileListProps;
  'context-metadata': ContextMetadataProps;
  'activity-log': ActivityLogProps;
}

export type ComponentSpec = {
  [K in ComponentType]: {
    type: K;
    props: ComponentPropsByType[K];
    /** Dot path into context state, e.g. `research.sources`. Advisory in v0. */
    binding?: string;
  };
}[ComponentType];

export interface Region {
  id: string;
  width?: RegionWidth;
  component: ComponentSpec;
}

export interface Layout {
  type: LayoutType;
  regions: Region[];
}

export interface SuggestedAction {
  id: string;
  label: string;
  description?: string;
  /** Capability this action would need. Surfaced to the user before it runs. */
  capability?: string;
  kind: 'agent' | 'system' | 'context';
}

export interface SairiUIDocument {
  version: typeof SAIRI_UI_VERSION;
  contextId: string | null;
  title: string;
  contextType: 'ephemeral' | 'persistent' | 'crystallized';
  layout: Layout;
  suggestedActions: SuggestedAction[];
}

export function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && (COMPONENT_TYPES as readonly string[]).includes(value);
}
