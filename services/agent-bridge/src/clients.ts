import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import type { Capability, Context } from '@sairios/context-schema';

/**
 * Thin clients for the two peer services.
 *
 * They are interfaces first so the bridge can be tested end to end without
 * sockets. The HTTP implementations below are the only place the bridge knows
 * that its peers are separate processes.
 */

export interface BrokerClient {
  propose(input: {
    contextId: string;
    capability: Capability;
    reason: string;
    payload: unknown;
  }): Promise<{ id: string; status: string; risk: string } | { error: string }>;

  /**
   * Current state of one request. The approval relay polls this while OpenClaw
   * waits, so it must reflect a decision made anywhere — the shell posts
   * decisions straight to the broker, not through the bridge.
   */
  status(requestId: string): Promise<{ status: string } | undefined>;

  /** Effective policy for a capability, before any prompt. */
  policy(capability: string): Promise<'allow' | 'ask' | 'deny'>;
}

export interface ContextClient {
  get(contextId: string): Promise<Context | undefined>;
  setUi(contextId: string, document: SairiUIDocument): Promise<{ ok: boolean; detail?: string }>;
  appendEvent(
    contextId: string,
    kind: string,
    summary: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

export class HttpBrokerClient implements BrokerClient {
  readonly #base: string;

  constructor(base: string) {
    this.#base = base.replace(/\/$/, '');
  }

  async propose(input: {
    contextId: string;
    capability: Capability;
    reason: string;
    payload: unknown;
  }): Promise<{ id: string; status: string; risk: string } | { error: string }> {
    try {
      const { status, body } = await postJson(`${this.#base}/requests`, input);
      if (status !== 201) {
        const message = (body as { error?: { message?: string } })?.error?.message;
        return { error: message ?? `Permission broker returned ${status}.` };
      }
      const request = body as { id: string; status: string; risk: string };
      return { id: request.id, status: request.status, risk: request.risk };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async status(requestId: string): Promise<{ status: string } | undefined> {
    try {
      const response = await fetch(`${this.#base}/requests/${encodeURIComponent(requestId)}`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as { status?: unknown };
      return typeof body.status === 'string' ? { status: body.status } : undefined;
    } catch {
      // Unreachable broker reads as "no answer", and the relay fails closed on
      // that. Returning a status here would be inventing one.
      return undefined;
    }
  }

  async policy(capability: string): Promise<'allow' | 'ask' | 'deny'> {
    try {
      const response = await fetch(`${this.#base}/policies`);
      if (!response.ok) return 'deny';
      // policySnapshot() returns { defaults, remembered }. Only defaults are
      // read here, and that is safe rather than sloppy: this check is a
      // fast-path whose only power is to refuse early. A remembered "deny and
      // remember" is still enforced, by the broker itself — propose() applies
      // the effective policy, so such a request lands as `denied` and the relay
      // sees that on its first poll. Nothing here can turn a deny into an
      // allow, because preDecide never auto-allows at all.
      const body = (await response.json()) as { defaults?: Record<string, unknown> };
      const value = body.defaults?.[capability];
      return value === 'allow' || value === 'ask' ? value : 'deny';
    } catch {
      // Fail closed. An unknown policy is treated as the strictest one, never
      // as permission.
      return 'deny';
    }
  }
}

export class HttpContextClient implements ContextClient {
  readonly #base: string;

  constructor(base: string) {
    this.#base = base.replace(/\/$/, '');
  }

  async get(contextId: string): Promise<Context | undefined> {
    try {
      const response = await fetch(`${this.#base}/contexts/${contextId}`);
      if (!response.ok) return undefined;
      return (await response.json()) as Context;
    } catch {
      return undefined;
    }
  }

  async setUi(
    contextId: string,
    document: SairiUIDocument,
  ): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await fetch(`${this.#base}/contexts/${contextId}/ui`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(document),
      });
      if (response.ok) return { ok: true };
      const body = (await response.json().catch(() => undefined)) as
        { error?: { message?: string } } | undefined;
      return {
        ok: false,
        detail: body?.error?.message ?? `Context service returned ${response.status}.`,
      };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async appendEvent(
    contextId: string,
    kind: string,
    summary: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await postJson(`${this.#base}/contexts/${contextId}/events`, { kind, summary, data });
    } catch {
      // The activity log is best-effort. Losing a log line must not abort an
      // agent run that is otherwise proceeding.
    }
  }
}
