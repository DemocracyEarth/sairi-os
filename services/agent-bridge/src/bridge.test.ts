import { describe, expect, it } from 'vitest';
import { ok } from '@sairios/shared';
import { validateSairiUI, type SairiUIDocument } from '@sairios/adaptive-ui-schema';
import type { Context } from '@sairios/context-schema';
import { AgentBridge, type BridgeEvent } from './bridge.js';
import type { BrokerClient, ContextClient } from './clients.js';
import { MockAgentProvider } from './providers/mock.js';
import { OpenClawAgentProvider, openclawCodec, type GatewaySocket } from './providers/openclaw.js';
import type { AgentEvent, AgentProvider, IntentionInput } from './provider.js';

const CONTEXT = 'ctx_0123456789abcdef0123456789abcdef';

class FakeBroker implements BrokerClient {
  readonly proposals: { capability: string; reason: string }[] = [];
  #counter = 0;
  /** What the next status() poll reports. Drives the relay tests. */
  nextStatus = 'allowed';
  /** Effective policy the relay reads before proposing. */
  nextPolicy: 'allow' | 'ask' | 'deny' = 'ask';

  async propose(input: { capability: string; reason: string }) {
    this.proposals.push({ capability: input.capability, reason: input.reason });
    this.#counter += 1;
    return {
      id: `req_${String(this.#counter).padStart(32, '0')}`,
      status: 'pending',
      risk: 'medium',
    };
  }

  async status(): Promise<{ status: string } | undefined> {
    return { status: this.nextStatus };
  }

  async policy(): Promise<'allow' | 'ask' | 'deny'> {
    return this.nextPolicy;
  }
}

class FakeContexts implements ContextClient {
  readonly events: { kind: string; summary: string }[] = [];
  readonly uiDocuments: SairiUIDocument[] = [];
  rejectUi = false;

  async get(): Promise<Context | undefined> {
    return undefined;
  }
  async setUi(_id: string, document: SairiUIDocument) {
    if (this.rejectUi) return { ok: false as const, detail: 'context service said no' };
    this.uiDocuments.push(document);
    return { ok: true as const };
  }
  async appendEvent(_id: string, kind: string, summary: string): Promise<void> {
    this.events.push({ kind, summary });
  }
}

async function collect(iterable: AsyncIterable<BridgeEvent>): Promise<BridgeEvent[]> {
  const out: BridgeEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

function input(intention: string): IntentionInput {
  return {
    contextId: CONTEXT,
    intention,
    contextType: 'ephemeral',
    contextName: 'Test context',
  };
}

describe('mock provider', () => {
  it('needs no credentials and reports itself as offline', async () => {
    const status = await new MockAgentProvider().status();
    expect(status.configured).toBe(true);
    expect(status.offline).toBe(true);
  });

  it('is deterministic across runs', async () => {
    const provider = new MockAgentProvider();
    const run = async (): Promise<AgentEvent[]> => {
      const session = await provider.createSession(CONTEXT);
      if (!session.ok) throw new Error('expected a session');
      const events: AgentEvent[] = [];
      for await (const event of provider.run(session.value, input('Compare three proposals'))) {
        events.push(event);
      }
      return events;
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it('always produces a SairiUI document that passes validation', async () => {
    const provider = new MockAgentProvider();
    const intentions = [
      'Compare three vendor proposals',
      'Research AI regulation in the EU',
      'SairiOS development project',
      'Weekly research briefing workflow',
      'Do the thing',
      '',
    ];
    for (const intention of intentions) {
      const session = await provider.createSession(CONTEXT);
      if (!session.ok) throw new Error('expected a session');
      let seen = false;
      for await (const event of provider.run(session.value, input(intention || 'x'))) {
        if (event.type === 'ui') {
          seen = true;
          const result = validateSairiUI(event.document);
          expect(result.ok, `invalid document for "${intention}": ${JSON.stringify(result)}`).toBe(
            true,
          );
        }
      }
      expect(seen, `no ui event for "${intention}"`).toBe(true);
    }
  });

  it('terminates every stream with done', async () => {
    const provider = new MockAgentProvider();
    const session = await provider.createSession(CONTEXT);
    if (!session.ok) throw new Error('expected a session');
    const events: AgentEvent[] = [];
    for await (const event of provider.run(session.value, input('anything'))) events.push(event);
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('agent bridge', () => {
  it('routes a capability request through the permission broker', async () => {
    const broker = new FakeBroker();
    const contexts = new FakeContexts();
    const bridge = new AgentBridge({ provider: new MockAgentProvider(), broker, contexts });

    const events = await collect(bridge.run(input('Compare three vendor proposals')));

    expect(broker.proposals).toHaveLength(1);
    expect(broker.proposals[0]?.capability).toBe('files.read');
    const pending = events.find((e) => e.type === 'permission-pending');
    expect(pending).toBeDefined();
  });

  it('never grants a permission itself', async () => {
    const broker = new FakeBroker();
    const bridge = new AgentBridge({
      provider: new MockAgentProvider(),
      broker,
      contexts: new FakeContexts(),
    });
    const events = await collect(bridge.run(input('Compare three vendor proposals')));
    // The bridge can only report a pending request; it has no allow path.
    for (const event of events) {
      expect(event.type).not.toBe('permission-granted');
    }
  });

  it('persists a valid UI document through the context service', async () => {
    const contexts = new FakeContexts();
    const bridge = new AgentBridge({
      provider: new MockAgentProvider(),
      broker: new FakeBroker(),
      contexts,
    });
    await collect(bridge.run(input('Research AI regulation')));
    expect(contexts.uiDocuments).toHaveLength(1);
    expect(contexts.uiDocuments[0]?.contextId).toBe(CONTEXT);
  });

  it('reports a rejection when the context service refuses the document', async () => {
    const contexts = new FakeContexts();
    contexts.rejectUi = true;
    const bridge = new AgentBridge({
      provider: new MockAgentProvider(),
      broker: new FakeBroker(),
      contexts,
    });
    const events = await collect(bridge.run(input('Research AI regulation')));
    expect(events.some((e) => e.type === 'ui-rejected')).toBe(true);
    expect(events.some((e) => e.type === 'ui')).toBe(false);
  });

  it('rejects a provider that returns an invalid document instead of rendering it', async () => {
    const rogue: AgentProvider = {
      name: 'rogue',
      status: async () => ({ provider: 'rogue', configured: true, offline: true, detail: '' }),
      createSession: async () => ({ ok: true, value: 'ses_x' }),
      async *run(): AsyncIterable<AgentEvent> {
        yield {
          type: 'ui',
          document: {
            version: '0.1',
            contextId: null,
            title: 'Rogue',
            contextType: 'ephemeral',
            layout: {
              type: 'stack',
              regions: [{ id: 'x', component: { type: 'iframe', props: {} } }],
            },
            suggestedActions: [],
          } as unknown as SairiUIDocument,
        };
        yield { type: 'done' };
      },
      closeSession: async () => {},
    };
    const contexts = new FakeContexts();
    const bridge = new AgentBridge({ provider: rogue, broker: new FakeBroker(), contexts });
    const events = await collect(bridge.run(input('anything')));
    expect(events.some((e) => e.type === 'ui-rejected')).toBe(true);
    expect(contexts.uiDocuments).toHaveLength(0);
  });

  it('turns a provider crash into an error event rather than throwing', async () => {
    const exploding: AgentProvider = {
      name: 'exploding',
      status: async () => ({ provider: 'exploding', configured: true, offline: true, detail: '' }),
      createSession: async () => ({ ok: true, value: 'ses_x' }),
      // eslint-disable-next-line require-yield
      async *run(): AsyncIterable<AgentEvent> {
        throw new Error('provider exploded');
      },
      closeSession: async () => {},
    };
    const bridge = new AgentBridge({
      provider: exploding,
      broker: new FakeBroker(),
      contexts: new FakeContexts(),
    });
    const events = await collect(bridge.run(input('anything')));
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('records the intention and the agent messages in the activity log', async () => {
    const contexts = new FakeContexts();
    const bridge = new AgentBridge({
      provider: new MockAgentProvider(),
      broker: new FakeBroker(),
      contexts,
    });
    await collect(bridge.run(input('Research AI regulation')));
    expect(contexts.events.map((e) => e.kind)).toContain('intention.submitted');
    expect(contexts.events.map((e) => e.kind)).toContain('agent.message');
  });
});

describe('openclaw provider', () => {
  it('reports honestly that it is unconfigured without a token', async () => {
    const provider = new OpenClawAgentProvider({
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: undefined,
    });
    const status = await provider.status();
    expect(status.configured).toBe(false);
    expect(status.detail).toContain('OPENCLAW_GATEWAY_TOKEN');
  });

  it('labels itself as scaffolding when configured', async () => {
    const provider = new OpenClawAgentProvider({
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'token',
    });
    const status = await provider.status();
    expect(status.detail).toContain('SCAFFOLDING');
  });

  it('never falls back to fabricated output when the gateway is unreachable', async () => {
    const provider = new OpenClawAgentProvider({
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'token',
      transport: {
        connect: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    const session = await provider.createSession(CONTEXT);
    if (!session.ok) throw new Error('expected a session');
    const events: AgentEvent[] = [];
    for await (const event of provider.run(session.value, input('anything'))) events.push(event);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'ui')).toBe(false);
  });

  it('streams normalized events from a fake gateway', async () => {
    // Real protocol-4 envelope: `type` is the category, the name is in `event`.
    // These shapes come from frames a live gateway actually sent; see
    // providers/gateway-frames.fixture.json.
    const frames = [
      JSON.stringify({ type: 'event', event: 'session.message', payload: { text: 'thinking' } }),
      JSON.stringify({
        type: 'event',
        event: 'session.operation',
        payload: {
          kind: 'ui',
          document: {
            version: '0.1',
            contextId: CONTEXT,
            title: 'From gateway',
            contextType: 'ephemeral',
            layout: {
              type: 'stack',
              regions: [{ id: 'a', component: { type: 'text', props: { body: 'hi' } } }],
            },
            suggestedActions: [],
          },
        },
      }),
      JSON.stringify({ type: 'event', event: 'shutdown', payload: {} }),
    ];
    const socket: GatewaySocket = {
      send: () => {},
      async *messages(): AsyncIterable<string> {
        for (const frame of frames) yield frame;
      },
      close: () => {},
    };
    const provider = new OpenClawAgentProvider({
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'token',
      transport: { connect: async () => socket },
    });
    const session = await provider.createSession(CONTEXT);
    if (!session.ok) throw new Error('expected a session');
    const events: AgentEvent[] = [];
    for await (const event of provider.run(session.value, input('x'))) events.push(event);
    expect(events.map((e) => e.type)).toEqual(['session', 'status', 'message', 'ui', 'done']);
  });
});

describe('openclaw frame normalization', () => {
  it('rejects a UI document from the gateway that fails validation', () => {
    const events = openclawCodec.decodeFrame(
      JSON.stringify({
        type: 'event',
        event: 'session.operation',
        payload: { kind: 'ui', document: { version: '9.9' } },
      }),
    );
    expect(events[0]?.type).toBe('ui-rejected');
  });

  it('ignores a frame whose name is in `type`, the way the old codec expected', () => {
    // Guards the specific mistake that made the placeholder unworkable. A
    // gateway never sends this, and reading it would mean the envelope was
    // being parsed wrong again.
    expect(openclawCodec.decodeFrame(JSON.stringify({ type: 'session.done' }))).toEqual([]);
    expect(openclawCodec.decodeFrame(JSON.stringify({ type: 'ui.specification' }))).toEqual([]);
  });

  it('surfaces a refused request as an error carrying the gateway code', () => {
    const events = openclawCodec.decodeFrame(
      JSON.stringify({
        type: 'res',
        id: '1',
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'invalid connect params' },
      }),
    );
    expect(events[0]?.type).toBe('error');
    expect(events[0] && 'message' in events[0] ? events[0].message : '').toContain(
      'INVALID_REQUEST',
    );
  });

  it('rejects an approval request naming an unknown capability', () => {
    const events = openclawCodec.decodeFrame(
      JSON.stringify({
        type: 'event',
        event: 'exec.approval.requested',
        payload: { capability: 'system.shell', reason: 'x' },
      }),
    );
    expect(events[0]?.type).toBe('error');
  });

  it('turns an approval request for a known capability into a broker request', () => {
    const events = openclawCodec.decodeFrame(
      JSON.stringify({
        type: 'event',
        event: 'exec.approval.requested',
        payload: { capability: 'files.read', reason: 'x', payload: {} },
      }),
    );
    expect(events[0]?.type).toBe('permission-request');
  });

  it('survives a frame that is not JSON', () => {
    const events = openclawCodec.decodeFrame('<html>gateway error page</html>');
    expect(events[0]?.type).toBe('error');
  });

  it('ignores frame types it does not know', () => {
    expect(openclawCodec.decodeFrame(JSON.stringify({ type: 'telemetry.ping' }))).toEqual([]);
  });
});

describe('OpenClaw approvals go through the broker, and are asked once', () => {
  /**
   * A provider that blocks on an answer, the way OpenClaw does: it raises an
   * approval carrying its own id and records whatever decision comes back.
   */
  class BlockingProvider implements AgentProvider {
    readonly name = 'openclaw';
    readonly answers: { externalId: string; decision: string; rationale: string }[] = [];

    async status() {
      return { provider: 'openclaw', configured: true, offline: false, detail: 'fake' };
    }
    async createSession() {
      return ok('ses_fake');
    }
    async closeSession() {}
    async resolveApproval(
      _sessionId: string,
      externalId: string,
      decision: 'allow' | 'deny',
      rationale: string,
    ) {
      this.answers.push({ externalId, decision, rationale });
    }
    async *run(): AsyncIterable<AgentEvent> {
      yield {
        type: 'permission-request',
        capability: 'files.read',
        reason: 'read the notes',
        payload: {},
        externalId: 'oc-1',
      };
      yield { type: 'done' };
    }
  }

  async function drain(broker: FakeBroker, provider: BlockingProvider) {
    const contexts = new FakeContexts();
    const bridge = new AgentBridge({ provider, broker, contexts });
    const events: BridgeEvent[] = [];
    for await (const event of bridge.run(input('read my notes'))) events.push(event);
    return { events, contexts };
  }

  it('raises exactly one broker request, not one per system', async () => {
    // The whole point: without this, OpenClaw prompts and SairiOS prompts.
    const broker = new FakeBroker();
    const provider = new BlockingProvider();
    await drain(broker, provider);
    expect(broker.proposals).toHaveLength(1);
    expect(broker.proposals[0]?.capability).toBe('files.read');
  });

  it('sends the decision back, so OpenClaw is not left waiting', async () => {
    const broker = new FakeBroker();
    const provider = new BlockingProvider();
    await drain(broker, provider);
    expect(provider.answers).toHaveLength(1);
    expect(provider.answers[0]).toMatchObject({ externalId: 'oc-1', decision: 'allow' });
  });

  it('tells OpenClaw no when the user denies', async () => {
    const broker = new FakeBroker();
    broker.nextStatus = 'denied';
    const provider = new BlockingProvider();
    const { events } = await drain(broker, provider);
    expect(provider.answers[0]?.decision).toBe('deny');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('refuses without asking when policy already denies', async () => {
    const broker = new FakeBroker();
    broker.nextPolicy = 'deny';
    const provider = new BlockingProvider();
    await drain(broker, provider);
    expect(broker.proposals).toHaveLength(0);
    expect(provider.answers[0]?.decision).toBe('deny');
  });

  it('still prompts when policy says allow, because that grant was for the sandbox', async () => {
    // An `allow` policy means the BROKER may act unprompted inside its sandbox.
    // It is not consent for OpenClaw to act outside one.
    const broker = new FakeBroker();
    broker.nextPolicy = 'allow';
    const provider = new BlockingProvider();
    await drain(broker, provider);
    expect(broker.proposals).toHaveLength(1);
  });

  it('records in the context that the action ran outside the sandbox', async () => {
    const broker = new FakeBroker();
    const { contexts } = await drain(broker, new BlockingProvider());
    const entry = contexts.events.find((e) => e.summary.includes('OpenClaw'));
    expect(entry).toBeDefined();
    expect(entry?.summary).toContain('allow');
  });
});
