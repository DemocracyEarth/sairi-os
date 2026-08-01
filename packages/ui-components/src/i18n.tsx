import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

/**
 * Localization.
 *
 * Spanish is the default because SairiOS is designed in Spanish and the product
 * has a voice; English exists so the project is legible to contributors who do
 * not read Spanish. Documentation and code stay English either way.
 *
 * `en` is the source of truth for the key set: `es` is typed as the same shape,
 * so adding a key to one and forgetting the other fails the build rather than
 * silently rendering a key name on screen.
 */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = { es: 'Español', en: 'English' };

const en = {
  // --- menu bar ---
  'menu.system': 'SairiOS',
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.contexts': 'Contexts',
  'menu.window': 'Window',
  'menu.help': 'Help',

  'menu.about': 'About SairiOS',
  'menu.systemStatus': 'System status',
  'menu.appearance': 'Appearance',
  'menu.language': 'Language',
  'menu.theme.light': 'Light',
  'menu.theme.dark': 'Dark',
  'menu.theme.auto': 'Match system',

  'menu.newContext': 'New context',
  'menu.openContextMap': 'Context map',
  'menu.openTerminal': 'Terminal',
  'menu.refresh': 'Refresh',
  'menu.closeWindow': 'Close window',
  'menu.minimizeAll': 'Minimize all',
  'menu.tileWindows': 'Tile windows',
  'menu.bringAllToFront': 'Bring all to front',
  'menu.markComplete': 'Mark complete',
  'menu.crystallize': 'Crystallize context',
  'menu.showArchived': 'Show archived',
  'menu.hideArchived': 'Hide archived',

  'help.everyWindow': 'Every window is a context',
  'help.appsAre': 'Applications are crystallized contexts',
  'help.validated': 'Agent interfaces are always validated',

  // --- desktop ---
  'dock.home': 'home',
  'dock.contexts': 'contexts',
  'dock.files': 'files',
  'dock.agents': 'agents',
  'desktop.projects': 'projects',
  'desktop.localDisk': 'local disk',
  'desktop.trash': 'trash',

  // --- windows ---
  'window.contextMap': 'context map',
  'window.contextMapSubtitle': 'overview of every context.',
  'window.terminal': 'terminal',
  'window.systemStatus': 'system status',
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',

  'window.ephemeralContext': 'ephemeral context',
  'window.persistentContext': 'persistent context',
  'window.crystallizedContext': 'crystallized context',
  'window.closesOnComplete': 'closes when completed',
  'window.staysOpen': 'stays open until you close it',
  'window.reusable': 'reusable',

  // --- context types ---
  'type.ephemeral': 'ephemeral',
  'type.persistent': 'persistent',
  'type.crystallized': 'crystallized',
  'type.ephemeral.plural': 'ephemeral',
  'type.persistent.plural': 'persistent',
  'type.crystallized.plural': 'crystallized',
  'type.ephemeral.blurb': 'temporary · close when completed',
  'type.persistent.blurb': 'open · evolve over time',
  'type.crystallized.blurb': 'reusable · stable',

  // --- status ---
  'status.draft': 'draft',
  'status.active': 'active',
  'status.waiting': 'waiting',
  'status.completed': 'completed',
  'status.archived': 'archived',
  'status.failed': 'failed',

  // --- context map ---
  'map.new': 'new',
  'map.total': '{count} contexts in total',
  'map.updated': 'updated: {time}',
  'map.lastActivity': 'last activity: {time}',
  'map.reused': 'reused: {count} times',
  'map.empty': 'Nothing here yet.',
  'map.noObjective': 'No objective recorded.',

  // --- intention ---
  'intention.prompt': 'What do you want to accomplish?',
  'intention.placeholder': 'Compare three vendor proposals',
  'intention.create': 'Create context',
  'intention.working': 'Working…',
  'intention.ephemeralOption': 'Ephemeral — a bounded task',
  'intention.persistentOption': 'Persistent — ongoing work',
  'intention.voiceNote':
    'Voice input is a documented future capability. Text only in this milestone.',

  // --- context window panels ---
  'panel.permissions': 'permissions',
  'panel.context': 'context',
  'panel.activity': 'agent activity',
  'panel.noPermissions': 'Nothing has been requested in this context.',
  'panel.agentIdle': 'agent idle',
  'panel.runWorkflow': 'Run this workflow',

  // --- permissions ---
  'perm.allowOnce': 'Allow once',
  'perm.allowContext': 'Allow for this context',
  'perm.deny': 'Deny',
  'perm.denyRemember': 'Deny and remember',
  'perm.cancel': 'Cancel',
  'perm.risk': '{level} risk',
  'perm.decided': 'Decided: {status}',
  'perm.request': 'Permission request',
  'perm.unverified': 'Unverified permission request',
  'perm.unverifiedBody':
    'The interface asked to approve {capability}, but the permission broker has no matching request. Nothing can be approved from here.',
  'perm.simulated': 'simulated',
  'perm.needsCapability': 'Requires {capability}. You will be asked before it runs.',

  // --- crystallization ---
  'crys.title': 'Crystallize context',
  'crys.intro':
    'A crystallized context is a reusable workflow. It keeps the shape of the work and deliberately leaves the contents of this run behind.',
  'crys.name': 'Template name',
  'crys.retained': 'Retained ({count})',
  'crys.removed': 'Removed ({count})',
  'crys.nothingRemoved': 'Nothing to remove.',
  'crys.confirm': 'Crystallize',
  'crys.working': 'Crystallizing…',
  'crys.cancel': 'Cancel',

  // --- system status ---
  'sys.runtime': 'runtime',
  'sys.model': 'model',
  'sys.memory': 'memory',
  'sys.memoryActive': 'active',
  'sys.services': 'services',
  'sys.contextService': 'contexts',
  'sys.agentBridge': 'bridge',
  'sys.permissionBroker': 'broker',
  'sys.provider': 'provider',
  'sys.ok': 'ok',
  'sys.down': 'down',
  'sys.unknown': '…',

  // --- renderer / errors ---
  'render.unverified': 'This interface could not be verified',
  'render.unverifiedBody':
    'SairiOS validates every interface an agent produces before rendering it. This one did not match the SairiUI protocol, so nothing from it was displayed.',
  'render.noInterface': 'No interface yet. Submit an intention and the agent will produce one.',
  'error.serviceUnreachable': 'The context service is not reachable',
  'error.agentFailed': 'The agent run failed',
  'error.cannotCreate': 'Could not create the context',
  'error.statusRefused': 'Status change refused',
  'error.needsCapability': 'That action needs a capability',
  'error.needsCapabilityBody':
    '"{action}" must be raised by the agent as a permission request before it can run.',

  // --- empty states inside catalog components ---
  'empty.sources': 'No sources yet.',
  'empty.nothing': 'Nothing recorded.',
  'empty.rows': 'No rows yet.',
  'empty.checklist': 'Nothing to check yet.',
  'empty.timeline': 'No entries.',
  'empty.status': 'No status reported.',
  'empty.files': 'No files in this context yet.',
  'empty.activity': 'Nothing has happened in this context yet.',
  'empty.noContext': 'No context loaded.',
  'label.untrusted': 'untrusted',
  'label.name': 'Name',
  'label.type': 'Type',
  'label.status': 'Status',
  'label.updated': 'Updated',
  'label.objective': 'Objective',

  // --- relative time ---
  'time.now': 'just now',
  'time.minutes': '{n}m ago',
  'time.hours': '{n}h ago',
  'time.days': '{n}d ago',
  'time.unknown': 'unknown',
  'bool.yes': 'yes',
  'bool.no': 'no',
} as const;

type Dict = Record<keyof typeof en, string>;

const es: Dict = {
  'menu.system': 'SairiOS',
  'menu.file': 'Archivo',
  'menu.edit': 'Edición',
  'menu.contexts': 'Contextos',
  'menu.window': 'Ventana',
  'menu.help': 'Ayuda',

  'menu.about': 'Acerca de SairiOS',
  'menu.systemStatus': 'Estado del sistema',
  'menu.appearance': 'Apariencia',
  'menu.language': 'Idioma',
  'menu.theme.light': 'Claro',
  'menu.theme.dark': 'Oscuro',
  'menu.theme.auto': 'Según el sistema',

  'menu.newContext': 'Nuevo contexto',
  'menu.openContextMap': 'Mapa de contextos',
  'menu.openTerminal': 'Terminal',
  'menu.refresh': 'Actualizar',
  'menu.closeWindow': 'Cerrar ventana',
  'menu.minimizeAll': 'Minimizar todo',
  'menu.tileWindows': 'Ordenar ventanas',
  'menu.bringAllToFront': 'Traer todo al frente',
  'menu.markComplete': 'Marcar como completo',
  'menu.crystallize': 'Cristalizar contexto',
  'menu.showArchived': 'Mostrar archivados',
  'menu.hideArchived': 'Ocultar archivados',

  'help.everyWindow': 'Cada ventana es un contexto',
  'help.appsAre': 'Las aplicaciones son contextos cristalizados',
  'help.validated': 'La interfaz del agente siempre se valida',

  'dock.home': 'inicio',
  'dock.contexts': 'contextos',
  'dock.files': 'archivos',
  'dock.agents': 'agentes',
  'desktop.projects': 'proyectos',
  'desktop.localDisk': 'disco local',
  'desktop.trash': 'papelera',

  'window.contextMap': 'mapa de contextos',
  'window.contextMapSubtitle': 'visión general de todos los contextos.',
  'window.terminal': 'terminal',
  'window.systemStatus': 'estado del sistema',
  'window.minimize': 'Minimizar',
  'window.maximize': 'Maximizar',
  'window.restore': 'Restaurar',
  'window.close': 'Cerrar',

  'window.ephemeralContext': 'contexto efímero',
  'window.persistentContext': 'contexto persistente',
  'window.crystallizedContext': 'contexto cristalizado',
  'window.closesOnComplete': 'se cerrará al completar',
  'window.staysOpen': 'permanece abierto hasta que decidas cerrarlo',
  'window.reusable': 'reutilizable',

  'type.ephemeral': 'efímero',
  'type.persistent': 'persistente',
  'type.crystallized': 'cristalizado',
  'type.ephemeral.plural': 'efímeros',
  'type.persistent.plural': 'persistentes',
  'type.crystallized.plural': 'cristalizados',
  'type.ephemeral.blurb': 'temporales · se cierran al completar',
  'type.persistent.blurb': 'abiertos · evolucionan con el tiempo',
  'type.crystallized.blurb': 'reutilizables · estables',

  'status.draft': 'borrador',
  'status.active': 'activo',
  'status.waiting': 'esperando',
  'status.completed': 'completado',
  'status.archived': 'archivado',
  'status.failed': 'fallido',

  'map.new': 'nuevo',
  'map.total': '{count} contextos en total',
  'map.updated': 'actualizado: {time}',
  'map.lastActivity': 'última actividad: {time}',
  'map.reused': 'reutilizado: {count} veces',
  'map.empty': 'Todavía no hay nada acá.',
  'map.noObjective': 'Sin objetivo registrado.',

  'intention.prompt': '¿Qué querés lograr?',
  'intention.placeholder': 'Comparar tres propuestas de proveedores',
  'intention.create': 'Crear contexto',
  'intention.working': 'Trabajando…',
  'intention.ephemeralOption': 'Efímero — una tarea acotada',
  'intention.persistentOption': 'Persistente — trabajo en curso',
  'intention.voiceNote':
    'La entrada por voz es una capacidad futura documentada. En este hito, solo texto.',

  'panel.permissions': 'permisos',
  'panel.context': 'contexto',
  'panel.activity': 'actividad del agente',
  'panel.noPermissions': 'No se solicitó nada en este contexto.',
  'panel.agentIdle': 'agente inactivo',
  'panel.runWorkflow': 'Ejecutar este flujo',

  'perm.allowOnce': 'Permitir una vez',
  'perm.allowContext': 'Permitir en este contexto',
  'perm.deny': 'Denegar',
  'perm.denyRemember': 'Denegar y recordar',
  'perm.cancel': 'Cancelar',
  'perm.risk': 'riesgo {level}',
  'perm.decided': 'Decidido: {status}',
  'perm.request': 'Solicitud de permiso',
  'perm.unverified': 'Solicitud de permiso no verificada',
  'perm.unverifiedBody':
    'La interfaz pidió aprobar {capability}, pero el intermediario de permisos no tiene una solicitud que coincida. Acá no se puede aprobar nada.',
  'perm.simulated': 'simulado',
  'perm.needsCapability': 'Requiere {capability}. Se te va a preguntar antes de ejecutarlo.',

  'crys.title': 'Cristalizar contexto',
  'crys.intro':
    'Un contexto cristalizado es un flujo reutilizable. Conserva la forma del trabajo y deja atrás, deliberadamente, el contenido de esta ejecución.',
  'crys.name': 'Nombre de la plantilla',
  'crys.retained': 'Se conserva ({count})',
  'crys.removed': 'Se elimina ({count})',
  'crys.nothingRemoved': 'No hay nada para eliminar.',
  'crys.confirm': 'Cristalizar',
  'crys.working': 'Cristalizando…',
  'crys.cancel': 'Cancelar',

  'sys.runtime': 'runtime',
  'sys.model': 'modelo',
  'sys.memory': 'memoria',
  'sys.memoryActive': 'activa',
  'sys.services': 'servicios',
  'sys.contextService': 'contextos',
  'sys.agentBridge': 'puente',
  'sys.permissionBroker': 'permisos',
  'sys.provider': 'proveedor',
  'sys.ok': 'ok',
  'sys.down': 'caído',
  'sys.unknown': '…',

  'render.unverified': 'No se pudo verificar esta interfaz',
  'render.unverifiedBody':
    'SairiOS valida toda interfaz que produce un agente antes de mostrarla. Esta no coincide con el protocolo SairiUI, así que no se mostró nada de ella.',
  'render.noInterface':
    'Todavía no hay interfaz. Enviá una intención y el agente va a producir una.',
  'error.serviceUnreachable': 'No se puede alcanzar el servicio de contextos',
  'error.agentFailed': 'Falló la ejecución del agente',
  'error.cannotCreate': 'No se pudo crear el contexto',
  'error.statusRefused': 'Cambio de estado rechazado',
  'error.needsCapability': 'Esa acción necesita una capacidad',
  'error.needsCapabilityBody':
    'El agente tiene que pedir "{action}" como solicitud de permiso antes de poder ejecutarla.',

  'empty.sources': 'Todavía no hay fuentes.',
  'empty.nothing': 'Nada registrado.',
  'empty.rows': 'Todavía no hay filas.',
  'empty.checklist': 'Todavía no hay nada para marcar.',
  'empty.timeline': 'Sin entradas.',
  'empty.status': 'Sin estado reportado.',
  'empty.files': 'Todavía no hay archivos en este contexto.',
  'empty.activity': 'Todavía no pasó nada en este contexto.',
  'empty.noContext': 'No hay contexto cargado.',
  'label.untrusted': 'no confiable',
  'label.name': 'Nombre',
  'label.type': 'Tipo',
  'label.status': 'Estado',
  'label.updated': 'Actualizado',
  'label.objective': 'Objetivo',

  'time.now': 'recién',
  'time.minutes': 'hace {n}m',
  'time.hours': 'hace {n}h',
  'time.days': 'hace {n}d',
  'time.unknown': 'desconocido',
  'bool.yes': 'sí',
  'bool.no': 'no',
};

const DICTIONARIES: Record<Locale, Dict> = { es, en };

export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  // Fall back to English rather than rendering the key: a missing translation
  // should degrade to a readable sentence, not to developer output on screen.
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const LocaleCtx = createContext<LocaleContextValue>({
  locale: 'es',
  setLocale: () => {},
  t: (key, vars) => translate('es', key, vars),
});

const STORAGE_KEY = 'sairios.locale';

function readStoredLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'es';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'es' ? stored : 'es';
}

export interface LocaleProviderProps {
  children: ReactNode;
  /**
   * Pins the starting locale instead of reading the stored preference. Tests use
   * this so an assertion is never at the mercy of whatever the last run wrote to
   * localStorage.
   */
  initialLocale?: Locale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    if (typeof document !== 'undefined') document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );

  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleCtx);
}

export function useT(): Translate {
  return useContext(LocaleCtx).t;
}

/** Exported for tests that assert both dictionaries stay in step. */
export const DICTIONARIES_FOR_TEST = DICTIONARIES;
