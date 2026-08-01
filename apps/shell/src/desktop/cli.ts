import type { Context, ContextType } from '@sairios/context-schema';
import type { Locale } from '@sairios/ui-components';

/**
 * The `contexto` command line.
 *
 * This drives the real context service. It is not a decorative terminal: every
 * command here goes through the same HTTP surface the windows use, so anything
 * you do in the terminal shows up in the context map, and anything the agent
 * does shows up here. A shell that lied about the system would be worse than no
 * shell at all.
 *
 * What it deliberately cannot do: run programs. There is no `sh`, no `exec`, no
 * passthrough to the host. The only verbs are context verbs, because the only
 * thing the environment lets you manipulate is contexts.
 */

export interface CliLine {
  text: string;
  tone?: 'dim' | 'error' | 'accent' | 'prompt';
}

export interface CliDeps {
  locale: Locale;
  listContexts: () => Promise<Context[]>;
  createContext: (name: string, type: ContextType, objective: string) => Promise<Context | string>;
  crystallize: (id: string) => Promise<Context | string>;
  setStatus: (id: string, status: 'completed' | 'active' | 'archived') => Promise<Context | string>;
  openContext: (id: string) => void;
  openMap: () => void;
  providerName: string;
  serviceHealth: () => { label: string; ok: boolean }[];
}

/** Short, human-typeable handle for a context: `c-` plus six hex from its id. */
export function shortId(context: Pick<Context, 'id'>): string {
  return `c-${context.id.replace(/^ctx_/, '').slice(0, 6)}`;
}

const STRINGS = {
  es: {
    unknown: (cmd: string) => `contexto: orden desconocida "${cmd}". Probá "ayuda".`,
    notFound: (q: string) => `contexto: no se encontró ningún contexto que coincida con "${q}".`,
    ambiguous: (q: string) => `contexto: "${q}" coincide con más de un contexto. Usá el ID.`,
    needsName: 'contexto crear: falta el nombre.',
    needsTarget: (verb: string) => `contexto ${verb}: falta el ID o el nombre.`,
    created: (s: string, n: string) => `contexto creado: ${s}  ${n}`,
    crystallized: (n: string) => `contexto cristalizado creado: ${n}`,
    completed: (n: string) => `marcado como completo: ${n}`,
    opened: (n: string) => `abriendo ventana: ${n}`,
    total: (n: number) => `${n} contextos`,
    headers: ['ID', 'NOMBRE', 'TIPO', 'ESTADO'],
    noShell: 'contexto: no hay shell. Este entorno solo manipula contextos, no procesos.',
    help: [
      'contexto listar                      lista todos los contextos',
      'contexto abrir <id|nombre>           abre la ventana del contexto',
      'contexto crear <nombre> [--persistente]',
      '                                     crea un contexto (efímero por defecto)',
      'contexto cristalizar <id|nombre>     crea una plantilla reutilizable',
      'contexto completar <id|nombre>       marca el contexto como completo',
      'contexto estado                      estado del sistema',
      'mapa                                 abre el mapa de contextos',
      'limpiar                              limpia la terminal',
      'ayuda                                esta ayuda',
    ],
    typeNames: { ephemeral: 'efímero', persistent: 'persistente', crystallized: 'cristalizado' },
    statusNames: {
      draft: 'borrador',
      active: 'activo',
      waiting: 'esperando',
      completed: 'completado',
      archived: 'archivado',
      failed: 'fallido',
    },
  },
  en: {
    unknown: (cmd: string) => `contexto: unknown command "${cmd}". Try "help".`,
    notFound: (q: string) => `contexto: no context matches "${q}".`,
    ambiguous: (q: string) => `contexto: "${q}" matches more than one context. Use the ID.`,
    needsName: 'contexto create: missing name.',
    needsTarget: (verb: string) => `contexto ${verb}: missing ID or name.`,
    created: (s: string, n: string) => `context created: ${s}  ${n}`,
    crystallized: (n: string) => `crystallized context created: ${n}`,
    completed: (n: string) => `marked complete: ${n}`,
    opened: (n: string) => `opening window: ${n}`,
    total: (n: number) => `${n} contexts`,
    headers: ['ID', 'NAME', 'TYPE', 'STATUS'],
    noShell: 'contexto: no shell here. This environment manipulates contexts, not processes.',
    help: [
      'contexto list                        list every context',
      'contexto open <id|name>              open the context window',
      'contexto create <name> [--persistent]',
      '                                     create a context (ephemeral by default)',
      'contexto crystallize <id|name>       create a reusable template',
      'contexto complete <id|name>          mark the context complete',
      'contexto status                      system status',
      'map                                  open the context map',
      'clear                                clear the terminal',
      'help                                 this help',
    ],
    typeNames: { ephemeral: 'ephemeral', persistent: 'persistent', crystallized: 'crystallized' },
    statusNames: {
      draft: 'draft',
      active: 'active',
      waiting: 'waiting',
      completed: 'completed',
      archived: 'archived',
      failed: 'failed',
    },
  },
} as const;

/** Command names accepted in either language, mapped to one internal verb. */
const VERBS: Record<string, string> = {
  listar: 'list',
  list: 'list',
  ls: 'list',
  abrir: 'open',
  open: 'open',
  crear: 'create',
  create: 'create',
  nuevo: 'create',
  cristalizar: 'crystallize',
  crystallize: 'crystallize',
  completar: 'complete',
  complete: 'complete',
  fijar: 'pin',
  pin: 'pin',
  estado: 'status',
  status: 'status',
  ayuda: 'help',
  help: 'help',
};

/** Splits a command line, honouring double quotes so names with spaces work. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? '');
  }
  return tokens;
}

/**
 * Pads to `width`, always leaving at least one trailing space. Without the
 * reserve, a value that exactly fills its column runs into the next one and the
 * table becomes unreadable at precisely the widths that matter.
 */
function pad(value: string, width: number): string {
  const room = width - 1;
  const text = value.length > room ? `${value.slice(0, room - 1)}…` : value;
  return text + ' '.repeat(Math.max(1, width - text.length));
}

function findContext(contexts: Context[], query: string): Context | 'none' | 'many' {
  const needle = query.toLowerCase();
  const byId = contexts.filter((c) => shortId(c) === needle || c.id === query);
  if (byId.length === 1) return byId[0] as Context;

  const exact = contexts.filter((c) => c.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0] as Context;

  const partial = contexts.filter((c) => c.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0] as Context;
  if (partial.length > 1) return 'many';
  return 'none';
}

export interface CliResult {
  lines: CliLine[];
  clear?: boolean;
}

export async function runCommand(input: string, deps: CliDeps): Promise<CliResult> {
  const s = STRINGS[deps.locale];
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { lines: [] };

  const head = (tokens[0] ?? '').toLowerCase();

  if (head === 'limpiar' || head === 'clear') return { lines: [], clear: true };
  if (head === 'mapa' || head === 'map') {
    deps.openMap();
    return { lines: [{ text: s.opened('mapa de contextos'), tone: 'accent' }] };
  }
  if (head === 'ayuda' || head === 'help') {
    return { lines: s.help.map((text) => ({ text, tone: 'dim' as const })) };
  }
  // The one thing people will try that this deliberately does not do.
  if (['sh', 'bash', 'sudo', 'exec', 'ssh'].includes(head)) {
    return { lines: [{ text: s.noShell, tone: 'error' }] };
  }
  if (head !== 'contexto' && head !== 'context') {
    return { lines: [{ text: s.unknown(head), tone: 'error' }] };
  }

  const verb = VERBS[(tokens[1] ?? '').toLowerCase()];
  if (!verb) return { lines: [{ text: s.unknown(tokens[1] ?? ''), tone: 'error' }] };
  const rest = tokens.slice(2).filter((tok) => !tok.startsWith('--'));
  const flags = tokens.slice(2).filter((tok) => tok.startsWith('--'));
  const target = rest.join(' ');

  switch (verb) {
    case 'list': {
      const contexts = await deps.listContexts();
      if (contexts.length === 0) return { lines: [{ text: s.total(0), tone: 'dim' }] };
      const [hId, hName, hType, hStatus] = s.headers;
      const lines: CliLine[] = [
        {
          text: `${pad(hId ?? '', 10)}${pad(hName ?? '', 32)}${pad(hType ?? '', 15)}${hStatus ?? ''}`,
          tone: 'dim',
        },
      ];
      for (const c of contexts) {
        lines.push({
          text:
            pad(shortId(c), 10) +
            pad(c.name, 32) +
            pad(s.typeNames[c.type], 15) +
            s.statusNames[c.status],
        });
      }
      lines.push({ text: '', tone: 'dim' });
      lines.push({ text: s.total(contexts.length), tone: 'dim' });
      return { lines };
    }

    case 'status': {
      const health = deps.serviceHealth();
      const lines: CliLine[] = [
        { text: `runtime   ${deps.providerName}`, tone: 'accent' },
        ...health.map((h) => ({
          text: `${pad(h.label, 10)}${h.ok ? 'ok' : 'down'}`,
          tone: h.ok ? ('dim' as const) : ('error' as const),
        })),
      ];
      return { lines };
    }

    case 'create': {
      if (!target) return { lines: [{ text: s.needsName, tone: 'error' }] };
      const type: ContextType =
        flags.includes('--persistente') || flags.includes('--persistent')
          ? 'persistent'
          : 'ephemeral';
      const created = await deps.createContext(target, type, target);
      if (typeof created === 'string') return { lines: [{ text: created, tone: 'error' }] };
      return { lines: [{ text: s.created(shortId(created), created.name), tone: 'accent' }] };
    }

    default: {
      if (!target) return { lines: [{ text: s.needsTarget(tokens[1] ?? verb), tone: 'error' }] };
      const contexts = await deps.listContexts();
      const found = findContext(contexts, target);
      if (found === 'none') return { lines: [{ text: s.notFound(target), tone: 'error' }] };
      if (found === 'many') return { lines: [{ text: s.ambiguous(target), tone: 'error' }] };

      switch (verb) {
        case 'open':
          deps.openContext(found.id);
          return { lines: [{ text: s.opened(found.name), tone: 'accent' }] };

        case 'crystallize': {
          const result = await deps.crystallize(found.id);
          if (typeof result === 'string') return { lines: [{ text: result, tone: 'error' }] };
          return { lines: [{ text: s.crystallized(result.name), tone: 'accent' }] };
        }

        case 'complete':
        case 'pin': {
          const next = verb === 'complete' ? 'completed' : 'active';
          const result = await deps.setStatus(found.id, next);
          if (typeof result === 'string') return { lines: [{ text: result, tone: 'error' }] };
          return { lines: [{ text: s.completed(result.name), tone: 'accent' }] };
        }

        default:
          return { lines: [{ text: s.unknown(verb), tone: 'error' }] };
      }
    }
  }
}
