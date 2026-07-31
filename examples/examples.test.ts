import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateSairiUI } from '@sairios/adaptive-ui-schema';
import { validateContext } from '@sairios/context-schema';

/**
 * The examples are documentation, so they are tested like code.
 *
 * A valid example that stops validating means the schema changed and the docs
 * did not. An invalid example that starts validating means a boundary was
 * loosened without anyone noticing, which is the more serious direction.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** `$comment` is documentation inside the fixture, not part of the payload. */
function withoutComment(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const { $comment: _comment, ...rest } = value as Record<string, unknown>;
  return rest;
}

describe('SairiUI examples', () => {
  it('every file starting with "rejected-" is refused, and every other file validates', async () => {
    const dir = join(HERE, 'sairi-ui');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const payload = withoutComment(await readJson(join(dir, file)));
      const result = validateSairiUI(payload);
      if (file.startsWith('rejected-')) {
        expect(result.ok, `${file} must be rejected`).toBe(false);
      } else {
        expect(result.ok, `${file} must validate: ${JSON.stringify(result)}`).toBe(true);
      }
    }
  });

  it('names the offending component when one is outside the catalog', async () => {
    const payload = withoutComment(
      await readJson(join(HERE, 'sairi-ui/rejected-unknown-component.json')),
    );
    const result = validateSairiUI(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('unknown-component');
      expect(result.error.unknownComponents).toContain('iframe');
    }
  });

  it('refuses props the catalog does not declare', async () => {
    const payload = withoutComment(
      await readJson(join(HERE, 'sairi-ui/rejected-injected-props.json')),
    );
    const result = validateSairiUI(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('schema');
      expect(result.error.messages.join(' ')).toContain('additional properties');
    }
  });

  it('covers all three context types with a valid document', async () => {
    const dir = join(HERE, 'sairi-ui');
    const files = (await readdir(dir)).filter(
      (f) => f.endsWith('.json') && !f.startsWith('rejected-'),
    );
    const types = new Set<string>();
    for (const file of files) {
      const result = validateSairiUI(await readJson(join(dir, file)));
      if (result.ok) types.add(result.value.contextType);
    }
    expect([...types].sort()).toEqual(['crystallized', 'ephemeral', 'persistent']);
  });
});

describe('context examples', () => {
  it('every example validates against the context schema', async () => {
    const dir = join(HERE, 'contexts');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(3);

    for (const file of files) {
      const result = validateContext(await readJson(join(dir, file)));
      expect(result.ok, `${file}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('the crystallized example carries a template and no run content', async () => {
    const result = validateContext(
      await readJson(join(HERE, 'contexts/crystallized-weekly-briefing.json')),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.template).toBeDefined();
    expect(result.value.template?.inputs.length).toBeGreaterThan(0);
    expect(result.value.template?.stages.some((s) => s.requiresApproval)).toBe(true);
    expect(result.value.artifacts).toHaveLength(0);
    expect(result.value.agentSession.sessionId).toBeNull();
  });

  it('contains no credential-shaped strings', async () => {
    const dir = join(HERE, 'contexts');
    for (const file of await readdir(dir)) {
      const raw = await readFile(join(dir, file), 'utf8');
      expect(raw, file).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
      expect(raw, file).not.toMatch(/(api[_-]?key|secret|password)"\s*:\s*"[^"]{8,}/i);
    }
  });
});
