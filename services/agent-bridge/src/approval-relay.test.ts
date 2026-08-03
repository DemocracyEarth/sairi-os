import { describe, expect, it, vi } from 'vitest';
import { preDecide, relayApproval, type RelayDeps, type RelayRequest } from './approval-relay.js';

/**
 * The OpenClaw approval relay.
 *
 * This is the seam where an external agent runtime asks SairiOS for permission
 * to do something SairiOS will not itself perform or contain. Almost every test
 * here asserts a refusal, because the failure that matters is not "a legitimate
 * request was blocked" — it is "something was allowed that nobody agreed to".
 *
 * The single rule: the ONLY path to `allow` is a broker request a human moved
 * to `allowed`. Every other path — a deny policy, a lost request, an
 * unreachable broker, a timeout, an unknown status — ends in `deny`.
 */

const REQUEST: RelayRequest = {
  externalId: 'oc-approval-1',
  contextId: 'ctx_0123456789abcdef0123456789abcdef',
  capability: 'files.write',
  reason: 'write the summary',
  payload: { path: 'notes.md' },
};

function deps(over: Partial<RelayDeps> = {}): RelayDeps & { resolved: unknown[] } {
  const resolved: unknown[] = [];
  return {
    resolved,
    propose: async () => ({ id: 'req_1' }),
    status: async () => ({ status: 'allowed' }),
    resolve: async (externalId, decision, rationale) => {
      resolved.push({ externalId, decision, rationale });
    },
    wait: async () => {},
    now: () => 0,
    ...over,
  } as RelayDeps & { resolved: unknown[] };
}

describe('a grant for the sandbox is not a grant for OpenClaw', () => {
  it('never auto-allows, even when local policy says allow', () => {
    // The escalation this prevents: `process.list` is `allow` because a
    // SANDBOXED listing is harmless. That is not consent for OpenClaw to run
    // it against the real machine unprompted.
    expect(preDecide('process.list', 'allow')).toBeUndefined();
    expect(preDecide('files.read', 'allow')).toBeUndefined();
  });

  it('honours a deny policy without prompting anyone', () => {
    const out = preDecide('clipboard.read', 'deny');
    expect(out?.decision).toBe('deny');
    expect(out?.rationale).toContain('deny');
  });

  it('refuses process.execute outright, whatever the policy says', () => {
    for (const policy of ['allow', 'ask', 'deny'] as const) {
      expect(preDecide('process.execute', policy)?.decision, policy).toBe('deny');
    }
  });
});

describe('the only route to allow', () => {
  it('is a broker request a human moved to allowed', async () => {
    const d = deps({ status: async () => ({ status: 'allowed' }) });
    const out = await relayApproval(REQUEST, 'ask', d);
    expect(out.decision).toBe('allow');
    expect(d.resolved).toEqual([
      { externalId: 'oc-approval-1', decision: 'allow', rationale: out.rationale },
    ]);
  });

  it('says plainly that OpenClaw, not the sandbox, will run it', async () => {
    // The user approved something. They are entitled to know it happens
    // somewhere the broker cannot contain or audit.
    const out = await relayApproval(REQUEST, 'ask', deps());
    expect(out.rationale).toMatch(/own process/i);
    expect(out.rationale).toMatch(/not.*sandbox/i);
  });
});

describe('everything else denies', () => {
  const cases: { name: string; over: Partial<RelayDeps>; expect?: RegExp }[] = [
    {
      name: 'the broker refuses the proposal',
      over: { propose: async () => ({ error: 'broker offline' }) },
      expect: /broker offline/,
    },
    {
      name: 'the request vanishes',
      over: { status: async () => undefined },
      expect: /lost the request/,
    },
    { name: 'the user denies', over: { status: async () => ({ status: 'denied' }) } },
    { name: 'the request is cancelled', over: { status: async () => ({ status: 'cancelled' }) } },
    { name: 'execution failed', over: { status: async () => ({ status: 'failed' }) } },
  ];

  for (const { name, over, expect: pattern } of cases) {
    it(`denies when ${name}`, async () => {
      const d = deps(over);
      const out = await relayApproval(REQUEST, 'ask', d);
      expect(out.decision).toBe('deny');
      if (pattern) expect(out.rationale).toMatch(pattern);
      expect(d.resolved).toHaveLength(1);
    });
  }

  it('denies on timeout, because silence is not consent', async () => {
    let clock = 0;
    const d = deps({
      status: async () => ({ status: 'pending' }),
      wait: async () => {
        clock += 500;
      },
      now: () => clock,
    });
    const out = await relayApproval(REQUEST, 'ask', d, { timeoutMs: 5000, pollIntervalMs: 500 });
    expect(out.decision).toBe('deny');
    expect(out.rationale).toMatch(/not consent/i);
  });

  it('keeps waiting through a status it does not recognise, rather than guessing', async () => {
    // A newer broker adding a status must not be read as approval.
    let clock = 0;
    const seen: string[] = [];
    const d = deps({
      status: async () => {
        seen.push('polled');
        return { status: 'quarantined-pending-review' };
      },
      wait: async () => {
        clock += 1000;
      },
      now: () => clock,
    });
    const out = await relayApproval(REQUEST, 'ask', d, { timeoutMs: 3000, pollIntervalMs: 1000 });
    expect(out.decision).toBe('deny');
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe('telling OpenClaw cannot change the answer', () => {
  it('still denies when the resolve call throws', async () => {
    const d = deps({
      status: async () => ({ status: 'denied' }),
      resolve: async () => {
        throw new Error('socket closed');
      },
    });
    const out = await relayApproval(REQUEST, 'ask', d);
    expect(out.decision).toBe('deny');
  });

  it('still allows when the resolve call throws, without inventing a denial', async () => {
    // Symmetry matters: a transport failure must not silently rewrite a
    // decision a human actually made. It is reported as made; OpenClaw's own
    // timeout refuses the action.
    const d = deps({
      status: async () => ({ status: 'allowed' }),
      resolve: async () => {
        throw new Error('socket closed');
      },
    });
    const out = await relayApproval(REQUEST, 'ask', d);
    expect(out.decision).toBe('allow');
  });

  it('resolves exactly once per request', async () => {
    const resolve = vi.fn(async () => {});
    const d = deps({ resolve });
    await relayApproval(REQUEST, 'ask', d);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('what reaches the broker', () => {
  it('carries the capability and reason unchanged, and never the external id', async () => {
    const propose = vi.fn(async () => ({ id: 'req_1' }));
    await relayApproval(REQUEST, 'ask', deps({ propose }));
    const sent = propose.mock.calls[0]?.[0] as RelayRequest;
    expect(sent.capability).toBe('files.write');
    expect(sent.reason).toBe('write the summary');
    expect(sent.contextId).toBe(REQUEST.contextId);
  });

  it('does not propose at all when the policy already refuses', async () => {
    const propose = vi.fn(async () => ({ id: 'req_1' }));
    const out = await relayApproval(REQUEST, 'deny', deps({ propose }));
    expect(out.decision).toBe('deny');
    expect(propose).not.toHaveBeenCalled();
  });
});
