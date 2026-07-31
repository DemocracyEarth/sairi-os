import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  readonly component: string;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Injectable sink so tests can capture output without touching stdout. */
  sink?: (line: string) => void;
  /** Injectable clock so tests stay deterministic. */
  now?: () => string;
}

/** Writes to stdout on Node, and falls back to the console elsewhere. */
function defaultSink(line: string): void {
  if (typeof process !== 'undefined' && process.stdout) process.stdout.write(`${line}\n`);
  else console.log(line);
}

function resolveLevel(explicit: LogLevel | undefined): LogLevel {
  if (explicit) return explicit;
  const fromEnv = typeof process === 'undefined' ? undefined : process.env['SAIRIOS_LOG_LEVEL'];
  if (fromEnv === 'debug' || fromEnv === 'info' || fromEnv === 'warn' || fromEnv === 'error') {
    return fromEnv;
  }
  return 'info';
}

export function createLogger(component: string, options: LoggerOptions = {}): Logger {
  const level = resolveLevel(options.level);
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date().toISOString());

  const emit = (entry: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[entry] < ORDER[level]) return;
    const record: Record<string, unknown> = {
      ts: now(),
      level: entry,
      component,
      msg: message,
    };
    if (fields) {
      // Every structured field passes through redaction before it can reach a
      // log file, the audit trail or the activity panel.
      Object.assign(record, redact(fields) as Record<string, unknown>);
    }
    sink(JSON.stringify(record));
  };

  return {
    component,
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (sub) => createLogger(`${component}.${sub}`, { ...options, level }),
  };
}
