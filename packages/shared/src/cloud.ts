/**
 * Cloud boundary interfaces.
 *
 * SairiOS has no production cloud backend and will not grow one implicitly.
 * These four interfaces exist so that the seam is designed now, while the
 * implementation stays local-only. The contract that matters:
 *
 *   Syncable context state and device-specific state are DIFFERENT THINGS.
 *
 * A context must be able to move between a desktop, a phone, a cloud VM and an
 * autonomous worker. Window geometry, focus and scroll position must not.
 * Secrets must never enter a synchronised document at all — a sync provider
 * receives ciphertext-shaped opaque documents plus a `secretRefs` list of
 * *names*, resolved locally through a `SecretProvider`.
 *
 * See docs/adr/0007-cloud-sync-boundary.md.
 */

/** Portion of a context safe to replicate to another device. */
export interface SyncableContextDocument {
  contextId: string;
  /** Monotonic per-device revision, used for last-writer-wins reconciliation. */
  revision: number;
  updatedAt: string;
  /** Opaque payload — the sync provider must not interpret it. */
  payload: unknown;
  /**
   * Names (never values) of secrets this context needs. Resolved on the target
   * device through a SecretProvider. A document containing a raw credential is
   * a bug and must be rejected by the provider.
   */
  secretRefs: readonly string[];
}

/** State that belongs to one device and is deliberately NOT synchronised. */
export interface DeviceLocalContextState {
  contextId: string;
  deviceId: string;
  windowGeometry?: { x: number; y: number; width: number; height: number };
  scrollPositions?: Record<string, number>;
  lastOpenedAt?: string;
}

export interface SyncConflict {
  contextId: string;
  localRevision: number;
  remoteRevision: number;
}

export interface ContextSyncProvider {
  readonly kind: string;
  push(doc: SyncableContextDocument): Promise<{ accepted: boolean; conflict?: SyncConflict }>;
  pull(contextId: string): Promise<SyncableContextDocument | undefined>;
  list(since?: string): Promise<readonly SyncableContextDocument[]>;
}

export interface SecretProvider {
  readonly kind: string;
  /** Returns undefined rather than throwing so callers degrade instead of crashing. */
  get(name: string): Promise<string | undefined>;
  has(name: string): Promise<boolean>;
  /** Enumerates NAMES only. No implementation may expose values in bulk. */
  listNames(): Promise<readonly string[]>;
}

export interface ArtifactRef {
  id: string;
  contextId: string;
  name: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

export interface ArtifactStore {
  readonly kind: string;
  put(contextId: string, name: string, data: Uint8Array, mediaType: string): Promise<ArtifactRef>;
  get(id: string): Promise<Uint8Array | undefined>;
  list(contextId: string): Promise<readonly ArtifactRef[]>;
  delete(id: string): Promise<boolean>;
}

export interface RemoteExecutionRequest {
  contextId: string;
  capability: string;
  payload: unknown;
}

export interface RemoteExecutionProvider {
  readonly kind: string;
  /**
   * Remote execution is gated by the same permission broker as local execution.
   * A provider implementation must never be given a path that bypasses it.
   */
  execute(
    request: RemoteExecutionRequest,
  ): Promise<{ status: 'ok' | 'denied' | 'error'; result?: unknown }>;
}

/** The only ContextSyncProvider that ships in v0: everything stays on this device. */
export class LocalOnlyContextSyncProvider implements ContextSyncProvider {
  readonly kind = 'local-only';
  readonly #docs = new Map<string, SyncableContextDocument>();

  async push(
    doc: SyncableContextDocument,
  ): Promise<{ accepted: boolean; conflict?: SyncConflict }> {
    const existing = this.#docs.get(doc.contextId);
    if (existing && existing.revision > doc.revision) {
      return {
        accepted: false,
        conflict: {
          contextId: doc.contextId,
          localRevision: existing.revision,
          remoteRevision: doc.revision,
        },
      };
    }
    this.#docs.set(doc.contextId, doc);
    return { accepted: true };
  }

  async pull(contextId: string): Promise<SyncableContextDocument | undefined> {
    return this.#docs.get(contextId);
  }

  async list(since?: string): Promise<readonly SyncableContextDocument[]> {
    const all = [...this.#docs.values()];
    return since ? all.filter((d) => d.updatedAt > since) : all;
  }
}

/** Reads secrets from the process environment. Never logs or bulk-exports values. */
export class EnvSecretProvider implements SecretProvider {
  readonly kind = 'env';
  readonly #prefix: string;

  constructor(prefix = 'SAIRIOS_SECRET_') {
    this.#prefix = prefix;
  }

  async get(name: string): Promise<string | undefined> {
    return process.env[`${this.#prefix}${name.toUpperCase()}`];
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }

  async listNames(): Promise<readonly string[]> {
    return Object.keys(process.env)
      .filter((k) => k.startsWith(this.#prefix))
      .map((k) => k.slice(this.#prefix.length).toLowerCase());
  }
}
