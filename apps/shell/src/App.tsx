import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { Context, ContextType, CrystallizationPreview } from '@sairios/context-schema';
import type { PendingPermission, SairiUIHost } from '@sairios/ui-components';
import {
  bridgeApi,
  brokerApi,
  contextApi,
  serviceEndpoints,
  type PermissionRequestRecord,
  type ProviderStatusRecord,
} from './api.js';
import { ContextMap } from './components/ContextMap.js';
import { ContextWindow } from './components/ContextWindow.js';
import { CrystallizeDialog } from './components/CrystallizeDialog.js';
import { GlobalMenu, type MenuDefinition } from './components/GlobalMenu.js';
import { IntentionEntry } from './components/IntentionEntry.js';

/**
 * The SairiOS desktop shell.
 *
 * Holds no domain logic. Lifecycle rules live in the context service, policy
 * lives in the permission broker, and the agent lives behind the bridge. This
 * component orchestrates those three and renders what they return.
 */

type Health = 'unknown' | 'ok' | 'down';

export function App(): JSX.Element {
  const [contexts, setContexts] = useState<Context[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [requests, setRequests] = useState<PermissionRequestRecord[]>([]);
  const [provider, setProvider] = useState<ProviderStatusRecord | null>(null);
  const [health, setHealth] = useState<{ contexts: Health; bridge: Health; broker: Health }>({
    contexts: 'unknown',
    bridge: 'unknown',
    broker: 'unknown',
  });
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    title: string;
    body: string;
    kind: 'warn' | 'error';
  } | null>(null);
  const [preview, setPreview] = useState<CrystallizationPreview | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const open = useMemo(() => contexts.find((c) => c.id === openId) ?? null, [contexts, openId]);

  const refreshContexts = useCallback(async (): Promise<void> => {
    const result = await contextApi.list();
    if (result.ok) {
      setContexts(result.value.contexts);
      setHealth((h) => ({ ...h, contexts: 'ok' }));
    } else {
      setHealth((h) => ({ ...h, contexts: 'down' }));
      setNotice({
        kind: 'error',
        title: 'The context service is not reachable',
        body: `${result.message} Expected at ${serviceEndpoints.contextService}. Start the stack with "make dev".`,
      });
    }
  }, []);

  const refreshRequests = useCallback(async (contextId: string | null): Promise<void> => {
    if (!contextId) {
      setRequests([]);
      return;
    }
    const result = await brokerApi.forContext(contextId);
    if (result.ok) {
      setRequests(result.value.requests);
      setHealth((h) => ({ ...h, broker: 'ok' }));
    } else {
      setHealth((h) => ({ ...h, broker: 'down' }));
    }
  }, []);

  useEffect(() => {
    void refreshContexts();
    void bridgeApi.provider().then((result) => {
      if (result.ok) {
        setProvider(result.value);
        setHealth((h) => ({ ...h, bridge: 'ok' }));
        if (!result.value.configured) {
          setNotice({
            kind: 'warn',
            title: `Agent provider "${result.value.provider}" is not configured`,
            body: result.value.detail,
          });
        }
      } else {
        setHealth((h) => ({ ...h, bridge: 'down' }));
      }
    });
    void brokerApi.health().then((result) => {
      setHealth((h) => ({ ...h, broker: result.ok ? 'ok' : 'down' }));
    });
  }, [refreshContexts]);

  useEffect(() => {
    void refreshRequests(openId);
  }, [openId, refreshRequests]);

  // --- agent run -----------------------------------------------------------

  const runIntention = useCallback(
    async (context: Context, intention: string): Promise<void> => {
      setBusy(true);
      setActivity('thinking');
      try {
        for await (const event of bridgeApi.runIntention({
          contextId: context.id,
          intention,
          contextType: context.type,
          contextName: context.name,
        })) {
          switch (event['type']) {
            case 'status':
              setActivity(String(event['status']));
              break;
            case 'message':
              setActivity(String(event['text']).slice(0, 60));
              break;
            case 'permission-pending':
              setActivity('waiting for your decision');
              await refreshRequests(context.id);
              break;
            case 'ui-rejected':
              setNotice({
                kind: 'error',
                title: 'The agent returned an interface SairiOS could not verify',
                body:
                  (event['messages'] as string[] | undefined)?.join(' ') ?? 'Validation failed.',
              });
              break;
            case 'error':
              setNotice({
                kind: 'error',
                title: 'The agent run failed',
                body: String(event['message']),
              });
              break;
            default:
              break;
          }
        }
      } finally {
        setBusy(false);
        setActivity(null);
        await refreshContexts();
        await refreshRequests(context.id);
      }
    },
    [refreshContexts, refreshRequests],
  );

  const createContext = useCallback(
    async (intention: string, type: Exclude<ContextType, 'crystallized'>): Promise<void> => {
      setNotice(null);
      const created = await contextApi.create({
        name: intention.length > 60 ? `${intention.slice(0, 57)}…` : intention,
        type,
        objective: intention,
      });
      if (!created.ok) {
        setNotice({ kind: 'error', title: 'Could not create the context', body: created.message });
        return;
      }
      await contextApi.submitIntention(created.value.id, intention);
      await refreshContexts();
      setOpenId(created.value.id);
      await runIntention(created.value, intention);
    },
    [refreshContexts, runIntention],
  );

  // --- permissions ---------------------------------------------------------

  const decide = useCallback(
    async (
      requestId: string,
      decision: 'allow' | 'deny',
      options: { scope: 'once' | 'context'; remember: boolean },
    ): Promise<void> => {
      const decided = await brokerApi.decide(requestId, decision, options);
      if (!decided.ok) {
        setNotice({ kind: 'error', title: 'Could not record the decision', body: decided.message });
        return;
      }
      // Approval and execution are separate steps in the broker. The shell
      // performs the second one explicitly so the audit trail shows both.
      if (decision === 'allow') {
        const executed = await brokerApi.execute(requestId);
        if (!executed.ok) {
          setNotice({ kind: 'warn', title: 'The action did not run', body: executed.message });
        }
      }
      await refreshRequests(openId);
      await refreshContexts();
    },
    [openId, refreshContexts, refreshRequests],
  );

  const cancelRequest = useCallback(
    async (requestId: string): Promise<void> => {
      await brokerApi.cancel(requestId);
      await refreshRequests(openId);
    },
    [openId, refreshRequests],
  );

  // --- crystallization -----------------------------------------------------

  const startCrystallize = useCallback(async (): Promise<void> => {
    if (!open) return;
    const result = await contextApi.previewCrystallize(open.id);
    if (!result.ok) {
      setNotice({ kind: 'warn', title: 'Cannot crystallize this context', body: result.message });
      return;
    }
    setPreview(result.value);
  }, [open]);

  const confirmCrystallize = useCallback(
    async (name: string): Promise<void> => {
      if (!open) return;
      setBusy(true);
      const result = await contextApi.crystallize(open.id, name);
      setBusy(false);
      setPreview(null);
      if (!result.ok) {
        setNotice({ kind: 'error', title: 'Crystallization failed', body: result.message });
        return;
      }
      await refreshContexts();
      setOpenId(result.value.context.id);
    },
    [open, refreshContexts],
  );

  const instantiate = useCallback(async (): Promise<void> => {
    if (!open) return;
    const result = await contextApi.instantiate(open.id);
    if (!result.ok) {
      setNotice({ kind: 'warn', title: 'Could not start this workflow', body: result.message });
      return;
    }
    await refreshContexts();
    setOpenId(result.value.id);
  }, [open, refreshContexts]);

  const complete = useCallback(async (): Promise<void> => {
    if (!open) return;
    const result = await contextApi.setStatus(open.id, 'completed');
    if (!result.ok) {
      setNotice({ kind: 'warn', title: 'Status change refused', body: result.message });
      return;
    }
    await refreshContexts();
  }, [open, refreshContexts]);

  // --- render host ---------------------------------------------------------

  const host: SairiUIHost = useMemo(() => {
    const permissions: Record<string, PendingPermission> = {};
    for (const request of requests) {
      permissions[request.id] = {
        requestId: request.id,
        capability: request.capability,
        reason: request.reason,
        risk: request.risk,
        status: request.status,
      };
    }
    return {
      context: open,
      permissions,
      busy,
      onPermissionDecision: (requestId, decision, options) =>
        void decide(requestId, decision, options),
      onAction: (actionId) => {
        // Suggested actions are opaque ids. Only the two the shell owns are
        // handled here; anything else needs a capability and therefore a
        // permission request, which the agent must raise.
        if (actionId === 'crystallize') void startCrystallize();
        else if (actionId === 'mark.complete') void complete();
        else if (actionId === 'run.briefing') void instantiate();
        else
          setNotice({
            kind: 'warn',
            title: 'That action needs a capability',
            body: `"${actionId}" must be raised by the agent as a permission request before it can run.`,
          });
      },
    };
  }, [busy, complete, decide, instantiate, open, requests, startCrystallize]);

  const menus: MenuDefinition[] = useMemo(
    () => [
      {
        title: 'SairiOS',
        commands: [
          { label: `Provider: ${provider?.provider ?? 'unknown'}` },
          { label: `Context service: ${serviceEndpoints.contextService}` },
          { label: `Agent bridge: ${serviceEndpoints.agentBridge}` },
          { label: `Permission broker: ${serviceEndpoints.permissionBroker}` },
        ],
      },
      {
        title: 'Archivo',
        commands: [
          { label: 'Nuevo contexto', onSelect: () => setOpenId(null) },
          { label: 'Actualizar', onSelect: () => void refreshContexts(), separatorBefore: true },
        ],
      },
      {
        title: 'Edición',
        commands: [
          { label: 'Marcar completado', onSelect: open ? () => void complete() : undefined },
          {
            label: 'Cristalizar contexto',
            onSelect:
              open && open.type !== 'crystallized' ? () => void startCrystallize() : undefined,
          },
        ],
      },
      {
        title: 'Contextos',
        commands: [
          { label: 'Mapa de contextos', onSelect: () => setOpenId(null) },
          {
            label: showArchived ? 'Ocultar archivados' : 'Mostrar archivados',
            onSelect: () => setShowArchived((v) => !v),
          },
        ],
      },
      {
        title: 'Ventana',
        commands: [
          { label: 'Cerrar contexto', onSelect: open ? () => setOpenId(null) : undefined },
        ],
      },
      {
        title: 'Ayuda',
        commands: [
          { label: 'Cada ventana es un contexto' },
          { label: 'Las aplicaciones son contextos cristalizados' },
          {
            label: 'La interfaz del agente siempre se valida',
            separatorBefore: true,
          },
        ],
      },
    ],
    [complete, open, provider, refreshContexts, showArchived, startCrystallize],
  );

  const statusItems = useMemo(
    () => [
      { label: `contexts ${health.contexts}`, state: healthState(health.contexts) },
      { label: `bridge ${health.bridge}`, state: healthState(health.bridge) },
      { label: `broker ${health.broker}`, state: healthState(health.broker) },
      {
        label: provider ? `provider ${provider.provider}` : 'provider …',
        state: provider?.configured === false ? ('warn' as const) : ('ok' as const),
      },
    ],
    [health, provider],
  );

  return (
    <div className="shell">
      <GlobalMenu menus={menus} status={statusItems} />
      <main className="workspace">
        <div className="workspace__inner">
          {notice && (
            <div className={`banner${notice.kind === 'error' ? ' banner--error' : ''}`}>
              <p className="banner__title">{notice.title}</p>
              <p className="banner__body">{notice.body}</p>
            </div>
          )}

          {open ? (
            <ContextWindow
              activity={activity}
              busy={busy}
              context={open}
              host={host}
              onCancelRequest={(id) => void cancelRequest(id)}
              onClose={() => setOpenId(null)}
              onComplete={() => void complete()}
              onCrystallize={() => void startCrystallize()}
              onDecision={(id, decision, options) => void decide(id, decision, options)}
              onInstantiate={() => void instantiate()}
              requests={requests}
            />
          ) : (
            <>
              <IntentionEntry
                busy={busy}
                onSubmit={(text, type) => void createContext(text, type)}
              />
              <ContextMap
                contexts={contexts}
                onOpen={(context) => setOpenId(context.id)}
                showArchived={showArchived}
              />
            </>
          )}
        </div>
      </main>

      {preview && (
        <CrystallizeDialog
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={(name) => void confirmCrystallize(name)}
          preview={preview}
        />
      )}
    </div>
  );
}

function healthState(value: Health): 'ok' | 'warn' | 'error' {
  if (value === 'ok') return 'ok';
  if (value === 'down') return 'error';
  return 'warn';
}
