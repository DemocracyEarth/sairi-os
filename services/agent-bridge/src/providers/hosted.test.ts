import { describe, expect, it, vi } from 'vitest';
import { HostedAgentProvider, decodeHostedEvent, transportIsSafe } from './hosted.js';
import type { AgentEvent, IntentionInput } from '../provider.js';

/**
 * The hosted provider.
 *
 * Two properties carry the design and both are about what must NOT happen:
 *
 *   - it never produces output when it could not reach a model, because a user
 *     who chose hosted inference must not be shown mock work dressed as a
 *     model's;
 *   - it validates the document even though SairiOS runs the server, because
 *     first-party is not the same as trusted (invariant 4 has no exception).
 */

const CONTEXT = 'ctx_0123456789abcdef0123456789abcdef';
const input = (intention: string): IntentionInput => ({
  contextId: CONTEXT,
  intention,
  contextType: 'ephemeral',
  contextName: 'test',
});

const DOCUMENT = {
  version: '0.1',
  contextId: CONTEXT,
  title: 'From the gateway',
  contextType: 'ephemeral',
  layout: {
    type: 'stack',
    regions: [{ id: 'a', component: { type: 'text', props: { body: 'hi' } } }],
  },
  suggestedActions: [],
};

/** A fetch that answers with the given NDJSON lines. */
function streaming(lines: string[], status = 200): typeof fetch {
  return (async () =>
    new Response(status === 200 ? lines.map((l) => `${l}\n`).join('') : null, {
      status,
      headers: { 'content-type': 'application/x-ndjson' },
    })) as unknown as typeof fetch;
}

async function collect(provider: HostedAgentProvider): Promise<AgentEvent[]> {
  const session = await provider.createSession(CONTEXT);
  if (!session.ok) return [{ type: 'error', message: session.error.message, recoverable: false }];
  const events: AgentEvent[] = [];
  for await (const e of provider.run(session.value, input('x'))) events.push(e);
  return events;
}

describe('transportIsSafe', () => {
  it('accepts https anywhere', () => {
    expect(transportIsSafe('https://gateway.sairi.computer')).toBe(true);
  });

  it('accepts plain http only on loopback, for local development', () => {
    expect(transportIsSafe('http://127.0.0.1:9000')).toBe(true);
    expect(transportIsSafe('http://localhost:9000')).toBe(true);
  });

  it('refuses to send an instance token over plaintext to anywhere else', () => {
    // The failure is silent otherwise: it works, so nobody notices the token
    // is readable by everything on the path.
    expect(transportIsSafe('http://gateway.sairi.computer')).toBe(false);
    expect(transportIsSafe('http://10.0.0.5:9000')).toBe(false);
    expect(transportIsSafe('ftp://gateway.sairi.computer')).toBe(false);
    expect(transportIsSafe('not a url')).toBe(false);
  });
});

describe('decodeHostedEvent', () => {
  it('drops a malformed line rather than throwing', () => {
    // One bad frame must not lose the frames after it.
    for (const line of ['', 'not json', '[]', '"a string"', '{"type":"unknown"}']) {
      expect(decodeHostedEvent(line)).toBeUndefined();
    }
  });

  it('refuses a status the union does not contain', () => {
    expect(decodeHostedEvent('{"type":"status","status":"vibing"}')).toBeUndefined();
    expect(decodeHostedEvent('{"type":"status","status":"thinking"}')).toEqual({
      type: 'status',
      status: 'thinking',
    });
  });

  it('refuses a capability that is not in the closed set', () => {
    // Otherwise a server could invent a capability name the broker has no
    // policy for and meet it with a default.
    expect(
      decodeHostedEvent('{"type":"permission-request","capability":"files.obliterate"}'),
    ).toBeUndefined();
    expect(
      decodeHostedEvent('{"type":"permission-request","capability":"files.read","reason":"r"}'),
    ).toMatchObject({ type: 'permission-request', capability: 'files.read' });
  });

  it('validates the document even though SairiOS runs the server', () => {
    expect(decodeHostedEvent(JSON.stringify({ type: 'ui', document: DOCUMENT }))?.type).toBe('ui');
    // First-party is not trusted. A bad document is rejected, not rendered.
    const bad = decodeHostedEvent(JSON.stringify({ type: 'ui', document: { version: '9.9' } }));
    expect(bad?.type).toBe('ui-rejected');
  });
});

describe('HostedAgentProvider', () => {
  const base = { gatewayUrl: 'https://gateway.sairi.computer', instanceToken: 'tok' };

  it('reports itself unconfigured without an instance token', async () => {
    const provider = new HostedAgentProvider({ ...base, instanceToken: undefined });
    const status = await provider.status();
    expect(status.configured).toBe(false);
    expect(status.detail).toContain('SAIRIOS_INSTANCE_TOKEN');
  });

  it('refuses a plaintext gateway before sending anything', async () => {
    const fetchImpl = vi.fn();
    const provider = new HostedAgentProvider({
      gatewayUrl: 'http://gateway.sairi.computer',
      instanceToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const events = await collect(provider);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    // The point is that the token never left.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('streams a turn and never invents one', async () => {
    const provider = new HostedAgentProvider({
      ...base,
      fetchImpl: streaming([
        '{"type":"status","status":"thinking"}',
        '{"type":"message","text":"reading"}',
        'garbage that is not json',
        JSON.stringify({ type: 'ui', document: DOCUMENT }),
        '{"type":"done"}',
      ]),
    });
    const events = await collect(provider);
    // The garbage line is dropped and the frames after it survive.
    expect(events.map((e) => e.type)).toEqual(['status', 'message', 'ui', 'done']);
  });

  it('produces no document when the gateway is unreachable', async () => {
    const provider = new HostedAgentProvider({
      ...base,
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const events = await collect(provider);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'ui')).toBe(false);
  });

  it('marks a 5xx retryable and a 401 not', async () => {
    for (const [status, recoverable] of [
      [500, true],
      [429, true],
      [401, false],
    ] as const) {
      const provider = new HostedAgentProvider({ ...base, fetchImpl: streaming([], status) });
      const events = await collect(provider);
      const error = events.find((e) => e.type === 'error');
      expect(error && 'recoverable' in error ? error.recoverable : undefined).toBe(recoverable);
    }
  });

  it('says so when the stream ends without finishing', async () => {
    // Otherwise the shell shows an agent that never completes.
    const provider = new HostedAgentProvider({
      ...base,
      fetchImpl: streaming(['{"type":"status","status":"thinking"}']),
    });
    const events = await collect(provider);
    const error = events.find((e) => e.type === 'error');
    expect(error && 'message' in error ? error.message : '').toContain('before the turn finished');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('sends the instance token as a bearer and no provider credential', async () => {
    let seen: RequestInit | undefined;
    const provider = new HostedAgentProvider({
      ...base,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = init;
        return new Response('{"type":"done"}\n', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await collect(provider);
    const headers = seen?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok');
    // An instance token identifies the instance. A provider key must never be
    // anywhere near this request — that is the entire reason the gateway exists.
    expect(JSON.stringify(seen?.body)).not.toMatch(/sk-|api[_-]?key/i);
  });
});
