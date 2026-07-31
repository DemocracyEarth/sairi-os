import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { newId, redact, systemClock, type Clock } from '@sairios/shared';
import type { Capability } from '@sairios/context-schema';

/**
 * Append-only audit log.
 *
 * Every privileged action is logged, attributable to a context, and visible to
 * the user. The log is JSON Lines so it survives a partial write and can be
 * tailed. Records pass through redaction on the way in.
 */

export type AuditPhase =
  | 'observed'
  | 'proposed'
  | 'auto-allowed'
  | 'auto-denied'
  | 'decided'
  | 'executed'
  | 'failed'
  | 'cancelled';

export interface AuditRecord {
  id: string;
  at: string;
  contextId: string;
  requestId: string;
  capability: Capability;
  phase: AuditPhase;
  summary: string;
  detail?: unknown;
}

export interface AuditSink {
  append(record: Omit<AuditRecord, 'id' | 'at'>): Promise<AuditRecord>;
  recent(limit: number, contextId?: string): Promise<readonly AuditRecord[]>;
}

export class FileAuditLog implements AuditSink {
  readonly #path: string;
  readonly #clock: Clock;
  #ready: Promise<void> | undefined;

  constructor(path: string, clock: Clock = systemClock) {
    this.#path = path;
    this.#clock = clock;
  }

  async #ensure(): Promise<void> {
    this.#ready ??= mkdir(dirname(this.#path), { recursive: true }).then(() => undefined);
    await this.#ready;
  }

  async append(record: Omit<AuditRecord, 'id' | 'at'>): Promise<AuditRecord> {
    await this.#ensure();
    const full: AuditRecord = {
      ...record,
      ...(record.detail === undefined ? {} : { detail: redact(record.detail) }),
      id: newId('act'),
      at: this.#clock.isoNow(),
    };
    await appendFile(this.#path, `${JSON.stringify(full)}\n`, { encoding: 'utf8', mode: 0o600 });
    return full;
  }

  async recent(limit: number, contextId?: string): Promise<readonly AuditRecord[]> {
    await this.#ensure();
    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch {
      return [];
    }
    const records: AuditRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as AuditRecord;
        if (contextId && parsed.contextId !== contextId) continue;
        records.push(parsed);
      } catch {
        // A truncated final line is expected after a crash; skip it rather than
        // failing the whole read.
      }
    }
    return records.slice(-limit);
  }
}

/** In-memory sink used by tests and by the mock development stack. */
export class MemoryAuditLog implements AuditSink {
  readonly #records: AuditRecord[] = [];
  readonly #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  async append(record: Omit<AuditRecord, 'id' | 'at'>): Promise<AuditRecord> {
    const full: AuditRecord = {
      ...record,
      ...(record.detail === undefined ? {} : { detail: redact(record.detail) }),
      id: newId('act'),
      at: this.#clock.isoNow(),
    };
    this.#records.push(full);
    return full;
  }

  async recent(limit: number, contextId?: string): Promise<readonly AuditRecord[]> {
    const filtered = contextId
      ? this.#records.filter((r) => r.contextId === contextId)
      : this.#records;
    return filtered.slice(-limit);
  }

  get all(): readonly AuditRecord[] {
    return this.#records;
  }
}
