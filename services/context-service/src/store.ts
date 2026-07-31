import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { validateContext, type Context } from '@sairios/context-schema';
import { createLogger, type Logger } from '@sairios/shared';
import { type StoreDriver } from '@sairios/shared/node';

/**
 * Local context persistence.
 *
 * Two drivers, one interface:
 *   - `sqlite` uses node:sqlite, which ships with Node itself. No native build
 *     step on any contributor machine and none in the VM image.
 *   - `json`   is a portable single-file fallback for Node builds without
 *     SQLite, and the driver the tests use.
 *
 * Everything read back off disk is re-validated against the context schema. A
 * file on disk is outside the trust boundary: it may have been edited, synced
 * or corrupted since it was written.
 */

const nodeRequire = createRequire(import.meta.url);

export interface ContextStore {
  readonly driver: 'sqlite' | 'json';
  init(): Promise<void>;
  list(): Promise<Context[]>;
  get(id: string): Promise<Context | undefined>;
  put(context: Context): Promise<void>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Minimal structural type for the node:sqlite surface actually used here. */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export class SqliteContextStore implements ContextStore {
  readonly driver = 'sqlite' as const;
  readonly #path: string;
  readonly #log: Logger;
  #db: SqliteDatabase | undefined;

  constructor(path: string, log: Logger = createLogger('context-store.sqlite')) {
    this.#path = path;
    this.#log = log;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    // Loaded through createRequire rather than a dynamic import.
    //
    // `node:sqlite` is deliberately absent from `module.builtinModules` while it
    // is experimental, so bundlers that decide "is this a builtin?" from that
    // list rewrite `import('node:sqlite')` into a bare `sqlite` package lookup
    // and fail. The store would then silently fall back to JSON under the test
    // runner while using SQLite in production — the worst of both. createRequire
    // resolves against Node directly and behaves identically either way.
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    const db = new DatabaseSync(this.#path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL,
        name        TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        document    TEXT NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS contexts_updated_at ON contexts(updated_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS contexts_type ON contexts(type)');
    this.#db = db;
    this.#log.info('sqlite context store ready', { path: this.#path });
  }

  #require(): SqliteDatabase {
    if (!this.#db) throw new Error('Context store used before init().');
    return this.#db;
  }

  async list(): Promise<Context[]> {
    const rows = this.#require()
      .prepare('SELECT document FROM contexts ORDER BY updated_at DESC')
      .all() as { document: string }[];
    return rows.flatMap((row) => this.#parse(row.document));
  }

  async get(id: string): Promise<Context | undefined> {
    const row = this.#require().prepare('SELECT document FROM contexts WHERE id = ?').get(id) as
      { document: string } | undefined;
    if (!row) return undefined;
    return this.#parse(row.document)[0];
  }

  async put(context: Context): Promise<void> {
    this.#require()
      .prepare(
        `INSERT INTO contexts (id, type, status, name, updated_at, document)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, status = excluded.status, name = excluded.name,
           updated_at = excluded.updated_at, document = excluded.document`,
      )
      .run(
        context.id,
        context.type,
        context.status,
        context.name,
        context.updatedAt,
        JSON.stringify(context),
      );
  }

  async delete(id: string): Promise<boolean> {
    const before = this.#require().prepare('SELECT id FROM contexts WHERE id = ?').get(id);
    if (!before) return false;
    this.#require().prepare('DELETE FROM contexts WHERE id = ?').run(id);
    return true;
  }

  async close(): Promise<void> {
    this.#db?.close();
    this.#db = undefined;
  }

  #parse(document: string): Context[] {
    try {
      const result = validateContext(JSON.parse(document));
      if (result.ok) return [result.value];
      this.#log.warn('dropping invalid context row', { errors: result.error.details });
    } catch (cause) {
      this.#log.warn('dropping unparseable context row', { error: cause });
    }
    return [];
  }
}

export class JsonContextStore implements ContextStore {
  readonly driver = 'json' as const;
  readonly #path: string;
  readonly #log: Logger;
  #cache = new Map<string, Context>();
  /** Serializes writes so two concurrent saves cannot interleave. */
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string, log: Logger = createLogger('context-store.json')) {
    this.#path = path;
    this.#log = log;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    try {
      const raw = await readFile(this.#path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const result = validateContext(entry);
          if (result.ok) this.#cache.set(result.value.id, result.value);
          else this.#log.warn('dropping invalid stored context', { errors: result.error.details });
        }
      }
    } catch {
      // First run, or an unreadable file. Start empty rather than refuse to boot.
      this.#cache = new Map();
    }
    this.#log.info('json context store ready', { path: this.#path, contexts: this.#cache.size });
  }

  async list(): Promise<Context[]> {
    return [...this.#cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Context | undefined> {
    return this.#cache.get(id);
  }

  async put(context: Context): Promise<void> {
    this.#cache.set(context.id, context);
    await this.#flush();
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.#cache.delete(id);
    if (existed) await this.#flush();
    return existed;
  }

  async close(): Promise<void> {
    await this.#writeChain;
  }

  async #flush(): Promise<void> {
    const snapshot = [...this.#cache.values()];
    this.#writeChain = this.#writeChain.then(async () => {
      // Write-then-rename: a crash mid-write leaves the previous file intact.
      const temp = `${this.#path}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.#path);
    });
    await this.#writeChain;
  }
}

/** In-memory store for tests and for the mock demo stack. */
export class MemoryContextStore implements ContextStore {
  readonly driver = 'json' as const;
  readonly #cache = new Map<string, Context>();

  async init(): Promise<void> {}
  async list(): Promise<Context[]> {
    return [...this.#cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string): Promise<Context | undefined> {
    return this.#cache.get(id);
  }
  async put(context: Context): Promise<void> {
    this.#cache.set(context.id, context);
  }
  async delete(id: string): Promise<boolean> {
    return this.#cache.delete(id);
  }
  async close(): Promise<void> {}
}

/**
 * Chooses a driver. `auto` prefers SQLite and falls back to JSON with a warning
 * rather than failing to start — persistence must never be the reason SairiOS
 * will not boot.
 */
export async function createContextStore(
  driver: StoreDriver,
  dataDir: string,
  log: Logger = createLogger('context-store'),
): Promise<ContextStore> {
  const sqlitePath = join(dataDir, 'contexts.db');
  const jsonPath = join(dataDir, 'contexts.json');

  if (driver === 'json') {
    const store = new JsonContextStore(jsonPath, log);
    await store.init();
    return store;
  }

  const sqlite = new SqliteContextStore(sqlitePath, log);
  try {
    await sqlite.init();
    return sqlite;
  } catch (cause) {
    if (driver === 'sqlite') throw cause;
    log.warn('node:sqlite unavailable, falling back to the JSON store', {
      error: cause,
      hint: 'Node 22.5+ with --experimental-sqlite, or Node 23.4+, provides node:sqlite.',
    });
    const store = new JsonContextStore(jsonPath, log);
    await store.init();
    return store;
  }
}
