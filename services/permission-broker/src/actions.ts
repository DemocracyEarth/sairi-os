import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Capability } from '@sairios/context-schema';
import { fail, ok, toSairiError, type Result } from '@sairios/shared';
import { type SairiEnv } from '@sairios/shared/node';
import type { Sandbox } from './sandbox.js';

/**
 * Capability execution.
 *
 * v0 rule: an action is either confined to the context sandbox, or it is
 * simulated. Nothing here reaches the host filesystem outside the sandbox, the
 * network, the clipboard, or a shell.
 *
 * `simulated: true` in the result is not decoration — the shell renders it, so
 * the user always knows whether something actually happened.
 */

export interface ActionOutcome {
  capability: Capability;
  simulated: boolean;
  summary: string;
  detail?: unknown;
}

export interface ActionContext {
  contextId: string;
  sandbox: Sandbox;
  env: SairiEnv;
}

/** Per-capability payload validation. Model output never reaches fs APIs unchecked. */
function readString(payload: unknown, key: string, maxLength = 1024): Result<string> {
  if (typeof payload !== 'object' || payload === null) {
    return fail('invalid_payload', 'Action payload must be an object.');
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_payload', `Action payload requires a non-empty string "${key}".`);
  }
  if (value.length > maxLength) {
    return fail('invalid_payload', `"${key}" exceeds ${maxLength} characters.`);
  }
  return ok(value);
}

/** Files written into the sandbox are capped so an agent cannot fill the disk. */
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_READ_BYTES = 512 * 1024;

/**
 * Executes a capability.
 *
 * Never throws. A filesystem error, a malformed payload or a bug in one handler
 * becomes a `Result` error that the broker records and the shell displays. An
 * exception escaping here would take down a request the user is watching.
 */
export async function executeAction(
  capability: Capability,
  payload: unknown,
  ctx: ActionContext,
): Promise<Result<ActionOutcome>> {
  try {
    return await runAction(capability, payload, ctx);
  } catch (cause) {
    return { ok: false, error: toSairiError(cause, 'action_failed') };
  }
}

async function runAction(
  capability: Capability,
  payload: unknown,
  ctx: ActionContext,
): Promise<Result<ActionOutcome>> {
  switch (capability) {
    case 'files.read': {
      const rel = readString(payload, 'path');
      if (!rel.ok) return rel;
      const resolved = await ctx.sandbox.resolvePath(ctx.contextId, rel.value);
      if (!resolved.ok) return resolved;
      if (!(await ctx.sandbox.isFile(resolved.value))) {
        return fail('not_found', `No file at "${rel.value}" in this context's sandbox.`);
      }
      const bytes = await readFile(resolved.value);
      if (bytes.byteLength > MAX_READ_BYTES) {
        return fail('too_large', `File exceeds the ${MAX_READ_BYTES} byte read limit.`);
      }
      return ok({
        capability,
        simulated: false,
        summary: `Read ${bytes.byteLength} bytes from ${rel.value}`,
        // Content originates from the sandbox and is therefore untrusted input
        // for anything downstream that consumes it.
        detail: {
          path: rel.value,
          byteSize: bytes.byteLength,
          content: bytes.toString('utf8'),
          untrusted: true,
        },
      });
    }

    case 'files.write': {
      const rel = readString(payload, 'path');
      if (!rel.ok) return rel;
      const content = readString(payload, 'content', MAX_WRITE_BYTES);
      if (!content.ok) return content;
      const resolved = await ctx.sandbox.resolvePath(ctx.contextId, rel.value);
      if (!resolved.ok) return resolved;
      // Parent directories are created inside the sandbox. `resolvePath` has
      // already proven the whole path stays within the context directory.
      await mkdir(dirname(resolved.value), { recursive: true, mode: 0o700 });
      await writeFile(resolved.value, content.value, { encoding: 'utf8', mode: 0o600 });
      return ok({
        capability,
        simulated: false,
        summary: `Wrote ${Buffer.byteLength(content.value)} bytes to ${rel.value}`,
        detail: { path: rel.value, byteSize: Buffer.byteLength(content.value) },
      });
    }

    case 'files.delete': {
      const rel = readString(payload, 'path');
      if (!rel.ok) return rel;
      const resolved = await ctx.sandbox.resolvePath(ctx.contextId, rel.value);
      if (!resolved.ok) return resolved;
      if (!(await ctx.sandbox.isFile(resolved.value))) {
        return fail('not_found', `No file at "${rel.value}" in this context's sandbox.`);
      }
      // Non-recursive on purpose: a capability grant for one file must not be
      // usable to remove a directory tree.
      await rm(resolved.value, { recursive: false, force: false });
      return ok({
        capability,
        simulated: false,
        summary: `Deleted ${rel.value}`,
        detail: { path: rel.value },
      });
    }

    case 'process.list': {
      // Deliberately reports SairiOS's own services rather than enumerating host
      // processes: `process.list` is allow-by-default, and a default-allow
      // capability must not leak what the user is running.
      return ok({
        capability,
        simulated: true,
        summary: 'Listed SairiOS services',
        detail: {
          services: [
            { name: 'context-service', port: ctx.env.contextServicePort },
            { name: 'agent-bridge', port: ctx.env.agentBridgePort },
            { name: 'permission-broker', port: ctx.env.permissionBrokerPort },
          ],
          note: 'Host processes are never enumerated for an agent.',
        },
      });
    }

    case 'process.execute': {
      // There is no implementation. This is the point: no code path exists from
      // an agent to process execution, independent of any policy setting.
      return fail(
        'not_implemented',
        'SairiOS v0 has no process execution path. An agent cannot run programs on this machine.',
      );
    }

    case 'network.fetch': {
      const url = readString(payload, 'url', 2048);
      if (!url.ok) return url;
      let parsed: URL;
      try {
        parsed = new URL(url.value);
      } catch {
        return fail('invalid_payload', 'The url is not a valid absolute URL.');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail('invalid_payload', 'Only http and https URLs may be requested.');
      }
      return ok({
        capability,
        simulated: true,
        summary: `Simulated fetch of ${parsed.origin}${parsed.pathname}`,
        detail: {
          url: parsed.toString(),
          status: 200,
          body: '[simulated response] SairiOS v0 does not perform real network requests.',
          note: 'Real fetching is a later milestone and will require an egress policy.',
        },
      });
    }

    case 'browser.open': {
      const url = readString(payload, 'url', 2048);
      if (!url.ok) return url;
      return ok({
        capability,
        simulated: true,
        summary: `Recorded intent to open ${url.value}`,
        detail: { url: url.value, note: 'No browser was launched.' },
      });
    }

    case 'clipboard.read': {
      return ok({
        capability,
        simulated: true,
        summary: 'Simulated clipboard read',
        detail: { content: '', note: 'The real clipboard is never read in v0.' },
      });
    }

    case 'clipboard.write': {
      const content = readString(payload, 'content', 10000);
      if (!content.ok) return content;
      return ok({
        capability,
        simulated: true,
        summary: `Simulated clipboard write (${content.value.length} characters)`,
        detail: { note: 'The real clipboard is never modified in v0.' },
      });
    }

    case 'notifications.send': {
      const message = readString(payload, 'message', 500);
      if (!message.ok) return message;
      return ok({
        capability,
        simulated: true,
        summary: `Notification: ${message.value}`,
        detail: { message: message.value, note: 'Recorded in the context activity log.' },
      });
    }

    case 'system.settings.read': {
      // SairiOS's own settings only. No environment variables, no host settings,
      // and nothing that could carry a credential.
      return ok({
        capability,
        simulated: false,
        summary: 'Read SairiOS settings',
        detail: {
          agentProvider: ctx.env.agentProvider,
          bindHost: ctx.env.bindHost,
          storeDriver: ctx.env.storeDriver,
          sandboxRoot: ctx.sandbox.root,
        },
      });
    }

    default: {
      const exhaustive: never = capability;
      return fail('unknown_capability', `Unknown capability: ${String(exhaustive)}`);
    }
  }
}
