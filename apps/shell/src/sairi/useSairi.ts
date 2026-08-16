import { useCallback, useEffect, useRef, useState } from 'react';
import type { Context } from '@sairios/context-schema';
import { brokerApi, contextApi, bridgeApi, type PermissionRequestRecord } from '../api.js';
import { IDLE_RUN, pushTrail, type RunState } from './state.js';

/**
 * The Sairi OS surface, connected to the actual system.
 *
 * Everything the shell used to render came from a fixture module. This hook is
 * what replaced it: contexts come from the context service and persist, an
 * intention starts a real agent run on the bridge, and the interface that comes
 * back is a SairiUI document the bridge validated before emitting.
 *
 * ---------------------------------------------------------------------------
 * It works with no API key, and that is not a fallback
 * ---------------------------------------------------------------------------
 * In mock mode the agent is deterministic and offline, but the loop is real in
 * every other respect: a real context is created and stored, a real run streams
 * over NDJSON, a real document is validated, real permission requests reach the
 * broker and wait for a real decision. That is the distinction this change is
 * about — not "is there a model", but "did any of this actually happen".
 *
 * A configured provider swaps the brain. It does not switch on the machinery.
 */

export interface SairiState {
  contexts: Context[];
  activeId: string;
  active: Context | undefined;
  run: RunState;
  /** Broker requests for the active context, keyed by id, for the renderer host. */
  permissions: Record<string, PermissionRequestRecord>;
  /** Set while the first load is in flight, so the shell can say so. */
  loading: boolean;
  /** Non-null when the services cannot be reached at all. */
  offline: string | undefined;
}

export interface SairiActions {
  select: (id: string) => void;
  /** Creates a context from an intention and runs the agent against it. */
  begin: (intention: string, agent?: string) => Promise<void>;
  decide: (
    requestId: string,
    decision: 'allow' | 'deny',
    options: { scope: 'once' | 'context'; remember: boolean },
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSairi(): SairiState & SairiActions {
  const [contexts, setContexts] = useState<Context[]>([]);
  const [activeId, setActiveId] = useState('');
  const [run, setRun] = useState<RunState>(IDLE_RUN);
  const [permissions, setPermissions] = useState<Record<string, PermissionRequestRecord>>({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState<string | undefined>();

  // Survives unmount mid-run: a stream that resolves after the component is
  // gone must not call setState, and an agent run is long enough for that to
  // happen in normal use.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await contextApi.list();
    if (!alive.current) return;
    if (!result.ok) {
      setOffline(result.message);
      setLoading(false);
      return;
    }
    setOffline(undefined);
    setContexts(result.value.contexts);
    setActiveId((current) => current || (result.value.contexts[0]?.id ?? ''));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Broker state for the active context, so the renderer can show real prompts. */
  const loadPermissions = useCallback(async (contextId: string) => {
    if (!contextId) return;
    const result = await brokerApi.forContext(contextId);
    if (!alive.current || !result.ok) return;
    setPermissions(Object.fromEntries(result.value.requests.map((r) => [r.id, r])));
  }, []);

  useEffect(() => {
    void loadPermissions(activeId);
  }, [activeId, loadPermissions]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    // The run belongs to a context, not to the shell. Switching away from a
    // context must not leave its status bar describing the one you left.
    setRun(IDLE_RUN);
  }, []);

  /**
   * One agent run, streamed into the surface.
   *
   * Extracted so that both entry points share it: a human stating an intention,
   * and a handover continuing the work with the agent it was handed to. Those
   * must behave identically — the second is not a lesser kind of run.
   */
  const stream = useCallback(
    async (context: Context, text: string, agent?: string) => {
      setRun({ status: 'thinking', trail: [] });
      for await (const event of bridgeApi.runIntention({
        contextId: context.id,
        intention: text,
        contextType: context.type,
        contextName: context.name,
        ...(agent ? { agent } : {}),
      })) {
        if (!alive.current) return;

        switch (event['type']) {
          case 'session':
            setRun((r) => ({ ...r, sessionId: String(event['sessionId'] ?? '') }));
            break;
          case 'status':
            setRun((r) => ({ ...r, status: event['status'] as RunState['status'] }));
            break;
          case 'message':
            setRun((r) => pushTrail(r, String(event['text'] ?? '')));
            break;
          case 'permission-pending':
            // The broker is the source of truth for what is pending, not the
            // stream — re-reading it is what keeps a stale event from painting
            // an approvable prompt the broker does not recognise.
            void loadPermissions(context.id);
            setRun((r) =>
              pushTrail(r, `Asked to use ${String(event['capability'] ?? 'a capability')}`),
            );
            break;
          case 'ui':
            // The document is persisted by the context service as part of the
            // run, so the context is re-read rather than patched locally.
            void contextApi.get(context.id).then((fresh) => {
              if (alive.current && fresh.ok) {
                setContexts((list) => list.map((c) => (c.id === fresh.value.id ? fresh.value : c)));
              }
            });
            setRun((r) => pushTrail(r, 'Built an interface for this context'));
            break;
          case 'error':
            setRun((r) => ({ ...r, status: 'idle', error: String(event['message'] ?? 'failed') }));
            break;
          case 'done':
            setRun((r) => ({ ...r, status: 'idle' }));
            void refresh();
            void loadPermissions(context.id);
            break;
          default:
            break;
        }
      }
    },
    [loadPermissions, refresh],
  );

  const begin = useCallback(
    async (intention: string, agent?: string) => {
      const text = intention.trim();
      if (!text) return;

      // A context first, because everything the run produces has to be
      // attributable to one — the permission broker refuses a request that is
      // not, and an unattributed grant cannot be scoped or revoked.
      const created = await contextApi.create({
        // The intention IS the name. A context called "Untitled 3" is the
        // folder metaphor this system exists to avoid.
        name: text.slice(0, 120),
        type: 'ephemeral',
        objective: text,
      });
      if (!alive.current) return;
      if (!created.ok) {
        setRun({ status: 'idle', trail: [], error: created.message });
        return;
      }

      const context = created.value;
      setContexts((list) => [context, ...list]);
      setActiveId(context.id);
      await contextApi.submitIntention(context.id, text);

      await stream(context, text, agent);
    },
    [stream],
  );

  const decide = useCallback(
    async (
      requestId: string,
      decision: 'allow' | 'deny',
      options: { scope: 'once' | 'context'; remember: boolean },
    ) => {
      const decided = await brokerApi.decide(requestId, decision, options);
      if (!alive.current || !decided.ok) return;
      // Deciding does not run it. The three phases stay separate here exactly
      // as they do in the broker: an allow still needs an execute.
      const ran = decision === 'allow' ? await brokerApi.execute(requestId) : undefined;
      if (!alive.current) return;
      await loadPermissions(activeId);
      await refresh();

      /*
       * A handover that actually ran continues the work with the agent it was
       * handed to. This is the loop automating itself, and it is the whole
       * point of the product — without it a person is still the transport
       * between two agents, which is the copy-pasting this exists to remove.
       *
       * The SHELL does this rather than the bridge, because the bridge never
       * watches the broker: it streams a run and forgets. The decision lands
       * here, so the continuation belongs here too.
       *
       * Only on a genuinely executed hop. A denial, a digest mismatch or a
       * failed execution must not start anything — `status` is checked rather
       * than the call's success, because the broker reports a refused action as
       * a FAILED request rather than a failed call.
       */
      if (ran?.ok && ran.value.capability === 'agent.relay' && ran.value.status === 'executed') {
        const to = (ran.value.payload as Record<string, unknown> | undefined)?.['to'];
        const context = contexts.find((c) => c.id === ran.value.contextId);
        if (typeof to === 'string' && context) {
          await stream(context, context.objective ?? context.name, to);
        }
      }
    },
    [activeId, contexts, loadPermissions, refresh, stream],
  );

  return {
    contexts,
    activeId,
    active: contexts.find((c) => c.id === activeId),
    run,
    permissions,
    loading,
    offline,
    select,
    begin,
    decide,
    refresh,
  };
}
