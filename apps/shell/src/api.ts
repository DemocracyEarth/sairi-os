import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import type {
  Context,
  ContextStatus,
  ContextType,
  CrystallizationPreview,
} from '@sairios/context-schema';

/**
 * Service clients.
 *
 * The shell speaks only to the three local services, never to a model provider.
 * Every call returns a discriminated result rather than throwing, so a service
 * that is not running produces a legible offline state instead of a white screen.
 */

const CONTEXT_BASE = import.meta.env['VITE_CONTEXT_SERVICE'] ?? 'http://127.0.0.1:7801';
const BRIDGE_BASE = import.meta.env['VITE_AGENT_BRIDGE'] ?? 'http://127.0.0.1:7802';
const BROKER_BASE = import.meta.env['VITE_PERMISSION_BROKER'] ?? 'http://127.0.0.1:7803';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } })?.error;
      return {
        ok: false,
        code: error?.code ?? `http_${response.status}`,
        message: error?.message ?? `Request failed with status ${response.status}.`,
      };
    }
    return { ok: true, value: body as T };
  } catch (cause) {
    return {
      ok: false,
      code: 'service_unreachable',
      message:
        cause instanceof Error && cause.message
          ? `Could not reach the service: ${cause.message}`
          : 'Could not reach the service.',
    };
  }
}

// --- context service -------------------------------------------------------

export const contextApi = {
  health: () =>
    request<{ status: string; storeDriver: string; contexts: number }>(`${CONTEXT_BASE}/healthz`),

  list: () => request<{ contexts: Context[] }>(`${CONTEXT_BASE}/contexts`),

  get: (id: string) => request<Context>(`${CONTEXT_BASE}/contexts/${id}`),

  create: (input: { name: string; type: ContextType; objective: string }) =>
    request<Context>(`${CONTEXT_BASE}/contexts`, { method: 'POST', body: JSON.stringify(input) }),

  submitIntention: (id: string, intention: string) =>
    request<Context>(`${CONTEXT_BASE}/contexts/${id}/intention`, {
      method: 'POST',
      body: JSON.stringify({ intention }),
    }),

  setStatus: (id: string, status: ContextStatus) =>
    request<Context>(`${CONTEXT_BASE}/contexts/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  previewCrystallize: (id: string) =>
    request<CrystallizationPreview>(`${CONTEXT_BASE}/contexts/${id}/crystallize/preview`),

  crystallize: (id: string, name?: string) =>
    request<{ context: Context; preview: CrystallizationPreview }>(
      `${CONTEXT_BASE}/contexts/${id}/crystallize`,
      { method: 'POST', body: JSON.stringify(name ? { name } : {}) },
    ),

  instantiate: (id: string, values?: Record<string, string>) =>
    request<Context>(`${CONTEXT_BASE}/contexts/${id}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ values: values ?? {} }),
    }),

  setUi: (id: string, document: SairiUIDocument) =>
    request<Context>(`${CONTEXT_BASE}/contexts/${id}/ui`, {
      method: 'PUT',
      body: JSON.stringify(document),
    }),
};

// --- permission broker -----------------------------------------------------

export interface PermissionRequestRecord {
  id: string;
  contextId: string;
  capability: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  status: string;
  createdAt: string;
  policySource: string;
  outcome?: { summary: string; simulated: boolean; detail?: unknown };
  error?: { code: string; message: string };
}

export interface CapabilityDescriptorRecord {
  capability: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  v0Behaviour: string;
  realSideEffect: boolean;
  defaultPolicy: string;
}

export const brokerApi = {
  health: () => request<{ status: string }>(`${BROKER_BASE}/healthz`),

  capabilities: () =>
    request<{ capabilities: CapabilityDescriptorRecord[] }>(`${BROKER_BASE}/capabilities`),

  forContext: (contextId: string) =>
    request<{ requests: PermissionRequestRecord[] }>(
      `${BROKER_BASE}/requests?contextId=${encodeURIComponent(contextId)}`,
    ),

  decide: (
    requestId: string,
    decision: 'allow' | 'deny',
    options: { scope: 'once' | 'context'; remember: boolean },
  ) =>
    request<PermissionRequestRecord>(`${BROKER_BASE}/requests/${requestId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...options }),
    }),

  execute: (requestId: string) =>
    request<PermissionRequestRecord>(`${BROKER_BASE}/requests/${requestId}/execute`, {
      method: 'POST',
    }),

  cancel: (requestId: string) =>
    request<PermissionRequestRecord>(`${BROKER_BASE}/requests/${requestId}/cancel`, {
      method: 'POST',
    }),
};

// --- agent bridge ----------------------------------------------------------

export interface BridgeEventRecord {
  type: string;
  [key: string]: unknown;
}

export interface ProviderStatusRecord {
  provider: string;
  configured: boolean;
  offline: boolean;
  detail: string;
}

export const bridgeApi = {
  provider: () => request<ProviderStatusRecord>(`${BRIDGE_BASE}/provider`),

  /**
   * Streams NDJSON events from the bridge. Yields each event as it arrives so
   * the context window can show progress rather than a spinner.
   */
  async *runIntention(input: {
    contextId: string;
    intention: string;
    contextType: ContextType;
    contextName: string;
  }): AsyncGenerator<BridgeEventRecord> {
    let response: Response;
    try {
      response = await fetch(`${BRIDGE_BASE}/intentions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify(input),
      });
    } catch {
      yield { type: 'error', message: 'The agent bridge is not reachable.', recoverable: false };
      yield { type: 'done' };
      return;
    }

    if (!response.ok || !response.body) {
      const body: unknown = await response.json().catch(() => undefined);
      const message =
        (body as { error?: { message?: string } })?.error?.message ??
        `The agent bridge returned ${response.status}.`;
      yield { type: 'error', message, recoverable: false };
      yield { type: 'done' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            yield JSON.parse(line) as BridgeEventRecord;
          } catch {
            // A malformed frame is dropped rather than aborting the stream.
          }
        }
        newline = buffer.indexOf('\n');
      }
    }
  },
};

export const serviceEndpoints = {
  contextService: CONTEXT_BASE,
  agentBridge: BRIDGE_BASE,
  permissionBroker: BROKER_BASE,
};
