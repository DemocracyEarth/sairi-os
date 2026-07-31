/**
 * The SairiOS context domain model.
 *
 * A context is a human intention plus everything that intention accumulates:
 * memory, files, tools, agents, permissions, objectives, tasks, UI state and
 * execution history. It is the primary abstraction of the system — not a
 * window, not a document, not a chat thread.
 *
 * Every window is a context.
 */

export const CONTEXT_SCHEMA_VERSION = '0.1' as const;

export const CONTEXT_TYPES = ['ephemeral', 'persistent', 'crystallized'] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const CONTEXT_STATUSES = [
  'draft',
  'active',
  'waiting',
  'completed',
  'archived',
  'failed',
] as const;
export type ContextStatus = (typeof CONTEXT_STATUSES)[number];

/**
 * Capabilities the permission broker understands. Kept in the context package
 * because a context's permission grants are part of its persisted state.
 */
export const CAPABILITIES = [
  'files.read',
  'files.write',
  'files.delete',
  'process.list',
  'process.execute',
  'network.fetch',
  'browser.open',
  'clipboard.read',
  'clipboard.write',
  'notifications.send',
  'system.settings.read',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const POLICY_DECISIONS = ['allow', 'ask', 'deny'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const MEMORY_SCOPES = ['durable', 'working', 'ephemeral'] as const;
/**
 * `durable`   — survives crystallization and sync (project facts, conventions).
 * `working`   — survives restart but is stripped on crystallization.
 * `ephemeral` — discarded when the context closes.
 */
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export interface MemoryEntry {
  key: string;
  value: string;
  scope: MemoryScope;
  /** Marks content derived from untrusted input (web pages, model output, files). */
  sensitive: boolean;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  name: string;
  /** Path relative to the context sandbox root. Never an absolute host path. */
  relativePath: string;
  mediaType: string;
  byteSize: number;
  sha256?: string;
  createdAt: string;
  /** True when the bytes originate from the agent or from the network. */
  untrusted: boolean;
}

export interface PermissionGrant {
  capability: Capability;
  decision: PolicyDecision;
  /** `once` grants are consumed on use; `context` grants persist with the context. */
  scope: 'once' | 'context';
  remembered: boolean;
  grantedAt: string;
  grantedBy: 'user' | 'default-policy';
  reason?: string;
}

export const TASK_STATUSES = ['pending', 'in-progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export const EVENT_KINDS = [
  'context.created',
  'context.status-changed',
  'context.renamed',
  'intention.submitted',
  'agent.message',
  'agent.tool-call',
  'agent.error',
  'ui.specification-updated',
  'ui.specification-rejected',
  'permission.requested',
  'permission.decided',
  'action.executed',
  'action.failed',
  'context.crystallized',
  'context.instantiated',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ContextEvent {
  id: string;
  kind: EventKind;
  at: string;
  /** Human-readable one-line summary shown in the activity log. */
  summary: string;
  /** Structured detail. Always redacted before it is written. */
  data?: Record<string, unknown>;
}

export interface AgentSession {
  /** Provider that produced this session: `mock` or `openclaw`. */
  provider: string;
  sessionId: string | null;
  status: 'idle' | 'thinking' | 'streaming' | 'waiting-permission' | 'error';
  startedAt?: string;
  lastActivityAt?: string;
  lastError?: string;
}

/**
 * Named input a crystallized context asks for when it is instantiated.
 * This is what turns a captured workflow into a reusable one.
 */
export interface TemplateInput {
  name: string;
  label: string;
  type: 'text' | 'multiline' | 'number' | 'date' | 'choice';
  required: boolean;
  choices?: readonly string[];
  defaultValue?: string;
  description?: string;
}

export interface WorkflowStage {
  id: string;
  title: string;
  description?: string;
  /** Whether this stage requires a human approval step before continuing. */
  requiresApproval: boolean;
}

/**
 * The reusable half of a crystallized context. Present only when
 * `type === 'crystallized'`. Everything here has passed sanitization.
 */
export interface CrystallizedTemplate {
  /** Prompt guidance carried forward. Sanitized — never raw conversation. */
  instructions: string;
  inputs: readonly TemplateInput[];
  stages: readonly WorkflowStage[];
  permissionDefaults: Readonly<Partial<Record<Capability, PolicyDecision>>>;
}

export interface Context {
  id: string;
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  name: string;
  type: ContextType;
  status: ContextStatus;
  createdAt: string;
  updatedAt: string;
  /** The human intention this context exists to serve. One sentence. */
  objective: string;
  memory: readonly MemoryEntry[];
  artifacts: readonly Artifact[];
  permissions: readonly PermissionGrant[];
  tasks: readonly Task[];
  events: readonly ContextEvent[];
  /** Validated SairiUI document. `null` until the agent produces one. */
  uiSpecification: unknown | null;
  agentSession: AgentSession;
  /** Set when this context was spawned from another (e.g. a sub-investigation). */
  parentContextId: string | null;
  /** Set when this context was instantiated FROM a crystallized template. */
  crystallizedFrom: string | null;
  /** Present only for `crystallized` contexts. */
  template?: CrystallizedTemplate;
}

/** Fields a caller may supply when creating a context. Everything else is derived. */
export interface CreateContextInput {
  name: string;
  type: ContextType;
  objective: string;
  parentContextId?: string | null;
  crystallizedFrom?: string | null;
}

export function isContextType(value: unknown): value is ContextType {
  return typeof value === 'string' && (CONTEXT_TYPES as readonly string[]).includes(value);
}

export function isContextStatus(value: unknown): value is ContextStatus {
  return typeof value === 'string' && (CONTEXT_STATUSES as readonly string[]).includes(value);
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}
