import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Context, ContextType, CrystallizationPreview } from '@sairios/context-schema';
import {
  THEME_PREFERENCES,
  useLocale,
  useT,
  useTheme,
  type MessageKey,
  type PendingPermission,
  type SairiUIHost,
} from '@sairios/ui-components';
import {
  bridgeApi,
  brokerApi,
  contextApi,
  serviceEndpoints,
  type PermissionRequestRecord,
  type ProviderStatusRecord,
} from './api.js';
import { CrystallizeDialog } from './desktop/CrystallizeDialog.js';
import { ContextMapWindow, dotFor } from './desktop/ContextMapWindow.js';
import {
  ContextWindowBody,
  contextWindowNote,
  contextWindowTitle,
} from './desktop/ContextWindowBody.js';
import { DesktopIcons, StatusBar, SystemStatus } from './desktop/DesktopFurniture.js';
import { Dock, type DockTarget } from './desktop/Dock.js';
import { Icon } from './desktop/icons.js';
import { MenuBar, type MenuDefinition } from './desktop/MenuBar.js';
import { Terminal } from './desktop/Terminal.js';
import { WindowFrame } from './desktop/Window.js';
import { LOCALE_LABELS, LOCALES } from '@sairios/ui-components';
import { useWindowManager, type Viewport, type WindowState } from './desktop/windows.js';
import { shortId, type CliDeps } from './desktop/cli.js';

/**
 * The SairiOS desktop.
 *
 * Holds no domain logic. Lifecycle rules live in the context service, policy in
 * the permission broker, and the agent behind the bridge. This orchestrates the
 * three, manages windows, and renders what they return.
 *
 * Window identity is derived from context identity — a context window is
 * `ctx:<contextId>` — so opening the same context twice raises the window that
 * already exists rather than creating a second view of one thing.
 */

const VERSION = '0.1';
type Health = 'unknown' | 'ok' | 'down';

const MAP_WINDOW = 'map';
const TERMINAL_WINDOW = 'terminal';
const STATUS_WINDOW = 'status';
const contextWindowId = (contextId: string): string => `ctx:${contextId}`;

export function App(): JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const theme = useTheme();

  const [contexts, setContexts] = useState<Context[]>([]);
  const [requests, setRequests] = useState<Record<string, PermissionRequestRecord[]>>({});
  const [provider, setProvider] = useState<ProviderStatusRecord | null>(null);
  const [health, setHealth] = useState<{ contexts: Health; bridge: Health; broker: Health }>({
    contexts: 'unknown',
    bridge: 'unknown',
    broker: 'unknown',
  });
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    title: string;
    body: string;
    kind: 'warn' | 'error';
  } | null>(null);
  const [preview, setPreview] = useState<{
    contextId: string;
    preview: CrystallizationPreview;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dock, setDock] = useState<DockTarget>('contexts');
  const [viewport, setViewport] = useState<Viewport>(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  const wm = useWindowManager();
  const openedInitial = useRef(false);

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // --- data ---------------------------------------------------------------

  const refreshContexts = useCallback(async (): Promise<Context[]> => {
    const result = await contextApi.list();
    if (result.ok) {
      setContexts(result.value.contexts);
      setHealth((h) => ({ ...h, contexts: 'ok' }));
      return result.value.contexts;
    }
    setHealth((h) => ({ ...h, contexts: 'down' }));
    setNotice({
      kind: 'error',
      title: t('error.serviceUnreachable'),
      body: `${result.message} ${serviceEndpoints.contextService}`,
    });
    return [];
  }, [t]);

  const refreshRequests = useCallback(async (contextId: string): Promise<void> => {
    const result = await brokerApi.forContext(contextId);
    if (result.ok) {
      setRequests((prev) => ({ ...prev, [contextId]: result.value.requests }));
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
      } else {
        setHealth((h) => ({ ...h, bridge: 'down' }));
      }
    });
    void brokerApi.health().then((r) => setHealth((h) => ({ ...h, broker: r.ok ? 'ok' : 'down' })));
  }, []);

  // The map is the entry point; open it once the desktop has a size to place it in.
  useEffect(() => {
    if (openedInitial.current) return;
    openedInitial.current = true;
    wm.open({ id: MAP_WINDOW, kind: 'context-map' }, viewport);
  }, []);

  const openContextWindow = useCallback(
    (contextId: string) => {
      wm.open({ id: contextWindowId(contextId), kind: 'context', contextId }, viewport);
      void refreshRequests(contextId);
    },
    [refreshRequests, viewport, wm],
  );

  // --- agent --------------------------------------------------------------

  const runIntention = useCallback(
    async (context: Context, intention: string): Promise<void> => {
      setBusy(true);
      setActivity((prev) => ({ ...prev, [context.id]: 'thinking' }));
      try {
        for await (const event of bridgeApi.runIntention({
          contextId: context.id,
          intention,
          contextType: context.type,
          contextName: context.name,
        })) {
          switch (event['type']) {
            case 'status':
              setActivity((prev) => ({ ...prev, [context.id]: String(event['status']) }));
              break;
            case 'message':
              setActivity((prev) => ({
                ...prev,
                [context.id]: String(event['text']).slice(0, 48),
              }));
              break;
            case 'permission-pending':
              await refreshRequests(context.id);
              break;
            case 'ui-rejected':
              setNotice({
                kind: 'error',
                title: t('render.unverified'),
                body: (event['messages'] as string[] | undefined)?.join(' ') ?? '',
              });
              break;
            case 'error':
              setNotice({
                kind: 'error',
                title: t('error.agentFailed'),
                body: String(event['message']),
              });
              break;
            default:
              break;
          }
        }
      } finally {
        setBusy(false);
        setActivity((prev) => {
          const next = { ...prev };
          delete next[context.id];
          return next;
        });
        await refreshContexts();
        await refreshRequests(context.id);
      }
    },
    [refreshContexts, refreshRequests, t],
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
        setNotice({ kind: 'error', title: t('error.cannotCreate'), body: created.message });
        return;
      }
      await contextApi.submitIntention(created.value.id, intention);
      await refreshContexts();
      openContextWindow(created.value.id);
      await runIntention(created.value, intention);
    },
    [openContextWindow, refreshContexts, runIntention, t],
  );

  // --- permissions --------------------------------------------------------

  const decide = useCallback(
    async (
      contextId: string,
      requestId: string,
      decision: 'allow' | 'deny',
      options: { scope: 'once' | 'context'; remember: boolean },
    ): Promise<void> => {
      const decided = await brokerApi.decide(requestId, decision, options);
      if (!decided.ok) {
        setNotice({ kind: 'error', title: t('error.statusRefused'), body: decided.message });
        return;
      }
      // Approval and execution are separate steps in the broker; the shell takes
      // the second one explicitly so the audit trail records both.
      if (decision === 'allow') await brokerApi.execute(requestId);
      await refreshRequests(contextId);
      await refreshContexts();
    },
    [refreshContexts, refreshRequests, t],
  );

  // --- context operations -------------------------------------------------

  const startCrystallize = useCallback(
    async (contextId: string): Promise<void> => {
      const result = await contextApi.previewCrystallize(contextId);
      if (!result.ok) {
        setNotice({ kind: 'warn', title: t('menu.crystallize'), body: result.message });
        return;
      }
      setPreview({ contextId, preview: result.value });
    },
    [t],
  );

  const confirmCrystallize = useCallback(
    async (name: string): Promise<void> => {
      if (!preview) return;
      setBusy(true);
      const result = await contextApi.crystallize(preview.contextId, name);
      setBusy(false);
      setPreview(null);
      if (!result.ok) {
        setNotice({ kind: 'error', title: t('menu.crystallize'), body: result.message });
        return;
      }
      await refreshContexts();
      openContextWindow(result.value.context.id);
    },
    [openContextWindow, preview, refreshContexts, t],
  );

  const instantiate = useCallback(
    async (contextId: string): Promise<void> => {
      const result = await contextApi.instantiate(contextId);
      if (!result.ok) {
        setNotice({ kind: 'warn', title: t('panel.runWorkflow'), body: result.message });
        return;
      }
      await refreshContexts();
      openContextWindow(result.value.id);
    },
    [openContextWindow, refreshContexts, t],
  );

  const complete = useCallback(
    async (contextId: string): Promise<void> => {
      const result = await contextApi.setStatus(contextId, 'completed');
      if (!result.ok) {
        setNotice({ kind: 'warn', title: t('error.statusRefused'), body: result.message });
        return;
      }
      await refreshContexts();
    },
    [refreshContexts, t],
  );

  // --- CLI ----------------------------------------------------------------

  const cliDeps = useMemo<CliDeps>(
    () => ({
      locale,
      // Read through to the service rather than the cached state: the terminal
      // must show what the system actually holds, including anything an agent
      // changed since the last render.
      listContexts: async () => {
        const result = await contextApi.list();
        return result.ok ? result.value.contexts : contexts;
      },
      createContext: async (name, type, objective) => {
        const r = await contextApi.create({ name, type, objective });
        if (!r.ok) return r.message;
        await refreshContexts();
        return r.value;
      },
      crystallize: async (id) => {
        const r = await contextApi.crystallize(id);
        if (!r.ok) return r.message;
        await refreshContexts();
        return r.value.context;
      },
      setStatus: async (id, status) => {
        const r = await contextApi.setStatus(id, status);
        if (!r.ok) return r.message;
        await refreshContexts();
        return r.value;
      },
      openContext: (id) => openContextWindow(id),
      openMap: () => wm.open({ id: MAP_WINDOW, kind: 'context-map' }, viewport),
      providerName: provider?.provider ?? 'mock',
      serviceHealth: () => [
        { label: t('sys.contextService'), ok: health.contexts === 'ok' },
        { label: t('sys.agentBridge'), ok: health.bridge === 'ok' },
        { label: t('sys.permissionBroker'), ok: health.broker === 'ok' },
      ],
    }),
    [contexts, health, locale, openContextWindow, provider, refreshContexts, t, viewport, wm],
  );

  // --- menus --------------------------------------------------------------

  const focusedContextId = useMemo(() => {
    const win = wm.windows.find((w) => w.id === wm.focusedId);
    return win?.contextId ?? null;
  }, [wm.focusedId, wm.windows]);

  const menus: MenuDefinition[] = useMemo(
    () => [
      {
        id: 'system',
        title: 'SairiOS',
        commands: [
          { label: `${t('menu.about')} ${VERSION}` },
          {
            label: t('menu.systemStatus'),
            onSelect: () => wm.open({ id: STATUS_WINDOW, kind: 'system-status' }, viewport),
            separatorBefore: true,
          },
          { label: t('menu.appearance'), heading: t('menu.appearance'), separatorBefore: true },
          ...THEME_PREFERENCES.map((pref) => ({
            label: t(`menu.theme.${pref}` as MessageKey),
            checked: theme.preference === pref,
            onSelect: () => theme.setPreference(pref),
          })),
          { label: t('menu.language'), heading: t('menu.language'), separatorBefore: true },
          ...LOCALES.map((code) => ({
            label: LOCALE_LABELS[code],
            checked: locale === code,
            onSelect: () => setLocale(code),
          })),
        ],
      },
      {
        id: 'file',
        title: t('menu.file'),
        commands: [
          {
            label: t('menu.newContext'),
            onSelect: () => wm.open({ id: MAP_WINDOW, kind: 'context-map' }, viewport),
          },
          {
            label: t('menu.openTerminal'),
            onSelect: () => wm.open({ id: TERMINAL_WINDOW, kind: 'terminal' }, viewport),
          },
          {
            label: t('menu.refresh'),
            onSelect: () => void refreshContexts(),
            separatorBefore: true,
          },
        ],
      },
      {
        id: 'edit',
        title: t('menu.edit'),
        commands: [
          {
            label: t('menu.markComplete'),
            onSelect: focusedContextId ? () => void complete(focusedContextId) : undefined,
          },
          {
            label: t('menu.crystallize'),
            onSelect: focusedContextId ? () => void startCrystallize(focusedContextId) : undefined,
          },
        ],
      },
      {
        id: 'contexts',
        title: t('menu.contexts'),
        commands: [
          {
            label: t('menu.openContextMap'),
            onSelect: () => wm.open({ id: MAP_WINDOW, kind: 'context-map' }, viewport),
          },
          {
            label: showArchived ? t('menu.hideArchived') : t('menu.showArchived'),
            onSelect: () => setShowArchived((v) => !v),
            separatorBefore: true,
          },
        ],
      },
      {
        id: 'window',
        title: t('menu.window'),
        commands: [
          { label: t('menu.tileWindows'), onSelect: () => wm.tile(viewport) },
          { label: t('menu.minimizeAll'), onSelect: () => wm.minimizeAll() },
          { label: t('menu.bringAllToFront'), onSelect: () => wm.bringAllToFront() },
          {
            label: t('menu.closeWindow'),
            onSelect: wm.focusedId ? () => wm.close(wm.focusedId as string) : undefined,
            separatorBefore: true,
          },
        ],
      },
      {
        id: 'help',
        title: t('menu.help'),
        commands: [
          { label: t('help.everyWindow') },
          { label: t('help.appsAre') },
          { label: t('help.validated'), separatorBefore: true },
        ],
      },
    ],
    [
      complete,
      focusedContextId,
      locale,
      refreshContexts,
      setLocale,
      showArchived,
      startCrystallize,
      t,
      theme,
      viewport,
      wm,
    ],
  );

  const services = useMemo(
    () => [
      { label: t('sys.contextService'), state: stateOf(health.contexts) },
      { label: t('sys.agentBridge'), state: stateOf(health.bridge) },
      { label: t('sys.permissionBroker'), state: stateOf(health.broker) },
    ],
    [health, t],
  );

  const minimized = wm.windows
    .filter((w) => w.minimized)
    .map((w) => ({ id: w.id, label: labelFor(w, contexts, t) }));

  // --- render -------------------------------------------------------------

  return (
    <div className="desktop">
      <MenuBar
        menus={menus}
        onOpenSystemStatus={() => wm.open({ id: STATUS_WINDOW, kind: 'system-status' }, viewport)}
        services={services}
      />

      <div className="desktop__surface">
        <Dock
          active={dock}
          onSelect={(target) => {
            setDock(target);
            if (target === 'contexts' || target === 'home') {
              wm.open({ id: MAP_WINDOW, kind: 'context-map' }, viewport);
            } else if (target === 'agents') {
              wm.open({ id: STATUS_WINDOW, kind: 'system-status' }, viewport);
            } else {
              wm.open({ id: TERMINAL_WINDOW, kind: 'terminal' }, viewport);
            }
          }}
        />

        <DesktopIcons
          onOpen={(target) =>
            target === 'trash'
              ? setShowArchived(true)
              : wm.open({ id: TERMINAL_WINDOW, kind: 'terminal' }, viewport)
          }
        />

        {wm.windows.map((win) => renderWindow(win))}
      </div>

      <StatusBar minimized={minimized} onRestore={wm.restore} version={VERSION}>
        <span className="sysstat__service">
          <span className={`dot dot--${provider?.configured === false ? 'warn' : 'ok'}`} />
          {t('sys.provider')} {provider?.provider ?? '…'}
        </span>
      </StatusBar>

      {preview && (
        <CrystallizeDialog
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={(name) => void confirmCrystallize(name)}
          preview={preview.preview}
        />
      )}
    </div>
  );

  function renderWindow(win: WindowState): JSX.Element | null {
    const common = {
      focused: wm.focusedId === win.id,
      key: win.id,
      onClose: () => wm.close(win.id),
      onFocus: () => wm.focus(win.id),
      onMinimize: () => wm.minimize(win.id),
      onMove: (x: number, y: number) => wm.move(win.id, x, y),
      onResize: (w: number, h: number) => wm.resize(win.id, w, h),
      onToggleMaximize: () => wm.toggleMaximize(win.id, viewport),
      viewport,
      window: win,
    };

    if (win.kind === 'context-map') {
      return (
        <WindowFrame
          {...common}
          icon={<Icon.map size={14} />}
          subtitle={t('window.contextMapSubtitle')}
          title={t('window.contextMap')}
        >
          {notice && (
            <div className={`banner${notice.kind === 'error' ? ' banner--error' : ''}`}>
              <p className="banner__title">{notice.title}</p>
              <p className="banner__body">{notice.body}</p>
            </div>
          )}
          <ContextMapWindow
            busy={busy}
            contexts={contexts}
            onCreate={(intention, type) => void createContext(intention, type)}
            onNew={() => undefined}
            onOpen={(context) => openContextWindow(context.id)}
            showArchived={showArchived}
          />
        </WindowFrame>
      );
    }

    if (win.kind === 'terminal') {
      return (
        <WindowFrame {...common} icon={<Icon.terminal size={14} />} title={t('window.terminal')}>
          <Terminal deps={cliDeps} />
        </WindowFrame>
      );
    }

    if (win.kind === 'system-status') {
      return (
        <WindowFrame {...common} icon={<Icon.chip size={14} />} title={t('window.systemStatus')}>
          <SystemStatus
            memoryActive={contexts.length > 0}
            memoryUsed={Math.min(1, contexts.reduce((n, c) => n + c.events.length, 0) / 500)}
            model={provider?.offline ? 'mock' : (provider?.provider ?? '—')}
            runtime={provider?.provider ?? '—'}
            services={services}
          />
        </WindowFrame>
      );
    }

    const context = contexts.find((c) => c.id === win.contextId);
    if (!context) return null;
    const contextRequests = requests[context.id] ?? [];

    const host: SairiUIHost = {
      context,
      busy,
      permissions: Object.fromEntries(
        contextRequests.map((r): [string, PendingPermission] => [
          r.id,
          {
            requestId: r.id,
            capability: r.capability,
            reason: r.reason,
            risk: r.risk,
            status: r.status,
          },
        ]),
      ),
      onPermissionDecision: (requestId, decision, options) =>
        void decide(context.id, requestId, decision, options),
      onAction: (actionId) => {
        if (actionId === 'crystallize') void startCrystallize(context.id);
        else if (actionId === 'mark.complete') void complete(context.id);
        else if (actionId === 'run.briefing') void instantiate(context.id);
        else
          setNotice({
            kind: 'warn',
            title: t('error.needsCapability'),
            body: t('error.needsCapabilityBody', { action: actionId }),
          });
      },
    };

    return (
      <WindowFrame
        {...common}
        badge={{ label: t(`type.${context.type}` as MessageKey), tone: context.type }}
        footer={contextWindowNote(context, t)}
        icon={<Icon.window size={14} />}
        meta={
          <>
            <span className={`dot dot--${dotFor(context.status)}`} />{' '}
            {t(`status.${context.status}` as MessageKey)}
            {activity[context.id] ? ` · ${activity[context.id]}` : ''}
          </>
        }
        title={contextWindowTitle(context, t)}
      >
        <ContextWindowBody
          context={context}
          host={host}
          onCancelRequest={(id) =>
            void brokerApi.cancel(id).then(() => refreshRequests(context.id))
          }
          onComplete={() => void complete(context.id)}
          onCrystallize={() => void startCrystallize(context.id)}
          onDecision={(id, decision, options) => void decide(context.id, id, decision, options)}
          onInstantiate={() => void instantiate(context.id)}
          requests={contextRequests}
        />
      </WindowFrame>
    );
  }
}

function stateOf(value: Health): 'ok' | 'warn' | 'error' | 'idle' {
  if (value === 'ok') return 'ok';
  if (value === 'down') return 'error';
  return 'idle';
}

function labelFor(win: WindowState, contexts: Context[], t: ReturnType<typeof useT>): string {
  if (win.kind === 'context-map') return t('window.contextMap');
  if (win.kind === 'terminal') return t('window.terminal');
  if (win.kind === 'system-status') return t('window.systemStatus');
  const context = contexts.find((c) => c.id === win.contextId);
  return context ? `${shortId(context)} ${context.name}` : win.id;
}
