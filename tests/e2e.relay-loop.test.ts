import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEnv } from '@sairios/shared/node';
import { MemoryAuditLog, PermissionBroker } from '@sairios/permission-broker';
import { MockAgentProvider } from '@sairios/agent-bridge';
import type { AgentEvent } from '@sairios/agent-bridge';

/**
 * The loop, end to end: one agent hands work to another.
 *
 * This is the demonstration the whole pivot rests on, and it runs with **no
 * credentials, no network and no external process** — two mock agents, the real
 * broker, a real sandbox, a real file. If this ever needs a key to pass, the
 * product has stopped being testable and invariant 6 has been broken.
 *
 * What it walks:
 *
 *   analyst asks to write a brief   -> approved -> a real file appears
 *   analyst asks to hand it over    -> approved -> digest verified, hop recorded
 *   the context is now tainted      -> a remembered grant stops resolving
 *   editor asks to read the brief   -> approved -> it gets the analyst's bytes
 *   anyone asks to hand on again    -> refused, structurally
 *
 * The last two steps are the point. The editor receives the work through its own
 * `files.read` rather than through anything the relay carried, and the chain
 * cannot continue — which is what makes this an orchestrator rather than a
 * prompt-injection amplifier.
 */

const CONTEXT = 'ctx_0123456789abcdef0123456789abcdef';

async function stack() {
  const dir = await mkdtemp(join(tmpdir(), 'sairios-loop-'));
  const env = readEnv({ SAIRIOS_DATA_DIR: dir, SAIRIOS_SANDBOX_DIR: join(dir, 'sandbox') });
  const broker = new PermissionBroker({ env, audit: new MemoryAuditLog() });
  return { broker, env };
}

/** Everything one agent asks for in a single run. */
async function askedFor(provider: MockAgentProvider): Promise<AgentEvent[]> {
  const session = await provider.createSession(CONTEXT);
  if (!session.ok) throw new Error(session.error.message);
  const events: AgentEvent[] = [];
  for await (const event of provider.run(session.value, {
    contextId: CONTEXT,
    intention: 'compare the vendor proposals',
    contextType: 'ephemeral',
    contextName: 'vendors',
  })) {
    events.push(event);
  }
  return events;
}

/** Propose, approve, run — the three phases, never collapsed. */
async function approveAndRun(
  broker: PermissionBroker,
  event: Extract<AgentEvent, { type: 'permission-request' }>,
) {
  const proposed = await broker.propose({
    contextId: CONTEXT,
    capability: event.capability,
    reason: event.reason,
    payload: event.payload,
  });
  if (!proposed.ok) return proposed;
  // A proposal never executes, whatever the policy says.
  expect(proposed.value.status).not.toBe('executed');
  if (proposed.value.status === 'pending') {
    await broker.decide(proposed.value.id, { decision: 'allow', scope: 'once', remember: false });
  }
  return broker.execute(proposed.value.id);
}

describe('one agent hands work to another', () => {
  it('walks the whole loop with no credentials', async () => {
    const { broker } = await stack();
    const analyst = new MockAgentProvider({ role: 'analyst' });
    const editor = new MockAgentProvider({ role: 'editor' });

    // The two agents are genuinely distinct, including their session ids — the
    // mock used to seed on the context alone, so a second agent in one context
    // silently joined the first.
    expect(analyst.name).toBe('mock.analyst');
    expect(editor.name).toBe('mock.editor');
    const a = await analyst.createSession(CONTEXT);
    const b = await editor.createSession(CONTEXT);
    expect(a.ok && b.ok && a.value).not.toBe(b.ok && b.value);

    // --- the analyst works, and asks ------------------------------------
    const analystAsks = (await askedFor(analyst)).filter(
      (e): e is Extract<AgentEvent, { type: 'permission-request' }> =>
        e.type === 'permission-request',
    );
    expect(analystAsks.map((e) => e.capability)).toEqual(['files.write', 'agent.relay']);

    const wrote = await approveAndRun(broker, analystAsks[0] as never);
    expect(wrote.ok, wrote.ok ? '' : wrote.error.message).toBe(true);

    // --- the handover ----------------------------------------------------
    const handed = await approveAndRun(broker, analystAsks[1] as never);
    expect(handed.ok, handed.ok ? '' : handed.error.message).toBe(true);
    if (!handed.ok) return;
    expect(handed.value.status).toBe('executed');
    const detail = handed.value.outcome?.detail as Record<string, unknown>;
    expect(detail['to']).toBe('mock.editor');
    // The relay itself moved nothing. That is the design, not a shortfall.
    expect(detail['delivered']).toBe(false);

    // --- the hop changed how this context is governed ---------------------
    const second = await broker.propose({
      contextId: CONTEXT,
      capability: 'agent.relay',
      reason: 'and on to a third',
      payload: analystAsks[1]?.payload,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('relay_chain_refused');

    // --- the editor receives the work, under its own grant ----------------
    const editorAsks = (await askedFor(editor)).filter(
      (e): e is Extract<AgentEvent, { type: 'permission-request' }> =>
        e.type === 'permission-request',
    );
    expect(editorAsks.map((e) => e.capability)).toEqual(['files.read']);

    const read = await approveAndRun(broker, editorAsks[0] as never);
    expect(read.ok, read.ok ? '' : read.error.message).toBe(true);
    if (!read.ok) return;
    const content = (read.value.outcome?.detail as Record<string, unknown>)['content'];
    // The editor is holding the analyst's actual bytes — delivered by its own
    // files.read, which the user approved separately.
    expect(String(content)).toContain('median');
    // And it arrived flagged as untrusted, because it did.
    expect((read.value.outcome?.detail as Record<string, unknown>)['untrusted']).toBe(true);
  });

  it('refuses the hop when the artifact is not the one that was described', async () => {
    // The digest, doing its job across the real broker rather than in isolation.
    const { broker } = await stack();
    const analyst = new MockAgentProvider({ role: 'analyst' });
    const asks = (await askedFor(analyst)).filter(
      (e): e is Extract<AgentEvent, { type: 'permission-request' }> =>
        e.type === 'permission-request',
    );

    await approveAndRun(broker, asks[0] as never);

    // Someone rewrites the file between the write and the handover.
    const tamper = await broker.propose({
      contextId: CONTEXT,
      capability: 'files.write',
      reason: 'swap it',
      payload: { path: 'brief.md', content: 'a different brief entirely' },
    });
    if (!tamper.ok) throw new Error(tamper.error.message);
    if (tamper.value.status === 'pending') {
      await broker.decide(tamper.value.id, { decision: 'allow', scope: 'once', remember: false });
    }
    await broker.execute(tamper.value.id);

    const handed = await approveAndRun(broker, asks[1] as never);
    // `execute` reports a refused action as a FAILED request rather than a
    // failed call — the request is real, it was authorised, and it did not run.
    // That distinction is why the audit trail can show an attempt.
    expect(handed.ok).toBe(true);
    if (!handed.ok) return;
    expect(handed.value.status).toBe('failed');
    expect(handed.value.error?.code).toBe('digest_mismatch');
    expect(handed.value.outcome).toBeUndefined();
  });
});
