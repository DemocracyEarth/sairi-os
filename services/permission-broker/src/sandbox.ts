import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail, ok, type Result } from '@sairios/shared';

/**
 * Sandbox path containment.
 *
 * Every filesystem path an agent proposes passes through here. The rules:
 *   - each context gets its own directory under the sandbox root;
 *   - paths are relative, with no absolute prefix and no `..` segments;
 *   - the resolved path is checked against the REAL path of the sandbox root,
 *     so a symlink planted inside the sandbox cannot point out of it;
 *   - the check is performed on the deepest existing ancestor, which closes the
 *     gap where a not-yet-created file's own realpath cannot be taken.
 *
 * This is the only place path containment is implemented. Nothing else in
 * SairiOS may build a filesystem path from agent-supplied input.
 */

const CONTEXT_DIR = /^ctx_[0-9a-f]{32}$/;

export interface SandboxOptions {
  root: string;
}

export class Sandbox {
  readonly #root: string;

  constructor(options: SandboxOptions) {
    this.#root = resolve(options.root);
  }

  get root(): string {
    return this.#root;
  }

  /** Creates (if needed) and returns the real path of a context's sandbox directory. */
  async ensureContextDir(contextId: string): Promise<Result<string>> {
    if (!CONTEXT_DIR.test(contextId)) {
      return fail('invalid_context_id', `"${contextId}" is not a context identifier.`);
    }
    const dir = join(this.#root, contextId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return ok(await realpath(dir));
  }

  /**
   * Resolves a context-relative path to an absolute path proven to sit inside
   * the sandbox. Returns an error instead of throwing so callers surface a
   * denial rather than a crash.
   */
  async resolvePath(contextId: string, relativePath: string): Promise<Result<string>> {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      return fail('invalid_path', 'A relative path is required.');
    }
    if (relativePath.length > 1024) {
      return fail('invalid_path', 'Path is too long.');
    }
    if (isAbsolute(relativePath) || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      return fail('path_escape', 'Absolute paths are not permitted inside a context sandbox.');
    }
    // NUL bytes truncate paths in some syscalls; reject before they reach one.
    if (relativePath.includes('\0')) {
      return fail('invalid_path', 'Path contains a null byte.');
    }
    const segments = relativePath.split(/[/\\]+/);
    if (segments.some((s) => s === '..')) {
      return fail('path_escape', 'Parent-directory segments ("..") are not permitted.');
    }

    const dirResult = await this.ensureContextDir(contextId);
    if (!dirResult.ok) return dirResult;
    const contextRoot = dirResult.value;

    const candidate = resolve(contextRoot, relativePath);
    if (!isInside(contextRoot, candidate)) {
      return fail('path_escape', 'Resolved path lies outside the context sandbox.');
    }

    // Follow symlinks on the deepest ancestor that exists. A symlink inside the
    // sandbox pointing at /etc would otherwise pass the lexical check above.
    const realAncestor = await deepestRealAncestor(candidate);
    if (!isInside(contextRoot, realAncestor) && realAncestor !== contextRoot) {
      return fail('path_escape', 'Path resolves through a symlink that leaves the sandbox.');
    }

    return ok(candidate);
  }

  /** True when the path exists and is a regular file inside the sandbox. */
  async isFile(absolutePath: string): Promise<boolean> {
    try {
      const info = await stat(absolutePath);
      return info.isFile();
    } catch {
      return false;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

async function deepestRealAncestor(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = current.slice(0, current.lastIndexOf(sep));
      if (!parent || parent === current) return current;
      current = parent;
    }
  }
}
