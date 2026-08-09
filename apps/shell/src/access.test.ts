import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, guard, readCookies, resolveAccess, tokensMatch } from '../access.mjs';

/**
 * The front door.
 *
 * The property worth defending is not "a token works" — it is that **there is
 * no configuration in which SairiOS listens off loopback without one**. The
 * services behind this process execute privileged actions and have no
 * authentication of their own, so an exposed unauthenticated shell is not a
 * degraded mode, it is a remote permission broker.
 *
 * So the first block asserts refusals, and there is deliberately no test for an
 * override flag, because there is deliberately no override flag.
 */

const TOKEN = 'a'.repeat(64);

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    body: '',
    ended: false,
    writeHead(status: number, headers?: Record<string, unknown>) {
      res.statusCode = status;
      Object.assign(res.headers, headers ?? {});
      return res;
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
      res.ended = true;
      return res;
    },
  };
  return res;
}

function req(overrides: Record<string, unknown> = {}) {
  return { method: 'GET', headers: {}, on: vi.fn(), ...overrides };
}

describe('resolveAccess — the interlock', () => {
  it('refuses to bind off loopback with no token', () => {
    const result = resolveAccess({ token: undefined, bindHost: '0.0.0.0' });
    expect(result.ok).toBe(false);
    // The message has to be actionable at 2am, not just correct.
    expect(result.message).toContain('refusing to bind');
    expect(result.message).toContain('SAIRIOS_ACCESS_TOKEN');
  });

  it('refuses an empty or whitespace token off loopback', () => {
    for (const token of ['', '   ', '\n']) {
      expect(resolveAccess({ token, bindHost: '192.168.1.10' }).ok).toBe(false);
    }
  });

  it('refuses a token short enough to guess', () => {
    // Worse than no token, because it looks like security.
    const result = resolveAccess({ token: 'hunter2', bindHost: '127.0.0.1' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('too short');
  });

  it('allows loopback with no token, and does not require one', () => {
    const result = resolveAccess({ token: undefined, bindHost: '127.0.0.1' });
    expect(result).toMatchObject({ ok: true, required: false, loopback: true });
  });

  it('treats ::1 and localhost as loopback too', () => {
    for (const host of ['::1', 'localhost']) {
      expect(resolveAccess({ token: undefined, bindHost: host }).ok).toBe(true);
    }
  });

  it('enforces a token on loopback when one is set', () => {
    // So the real authenticated path can be exercised without exposing anything.
    const result = resolveAccess({ token: TOKEN, bindHost: '127.0.0.1' });
    expect(result).toMatchObject({ ok: true, required: true });
  });

  it('refuses a token that cannot be put in a cookie', () => {
    // Node throws ERR_INVALID_CHAR writing a non-latin-1 header value, which
    // crashed the process from inside the sign-in handler. Refused at startup
    // instead, where the operator can read why.
    for (const bad of ['\u4e2d'.repeat(40), `${'a'.repeat(40)};drop`, `${'a'.repeat(40)} sp`]) {
      expect(resolveAccess({ token: bad, bindHost: '127.0.0.1' }).ok).toBe(false);
    }
  });

  it('accepts hex and base64 tokens', () => {
    for (const good of ['a1b2c3d4'.repeat(8), `${'A'.repeat(40)}+/=`]) {
      expect(resolveAccess({ token: good, bindHost: '0.0.0.0' }).ok).toBe(true);
    }
  });

  it('accepts a long token off loopback', () => {
    expect(resolveAccess({ token: TOKEN, bindHost: '0.0.0.0' })).toMatchObject({
      ok: true,
      required: true,
      loopback: false,
    });
  });
});

describe('tokensMatch', () => {
  it('accepts only an exact match', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(tokensMatch(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokensMatch('b'.repeat(64), TOKEN)).toBe(false);
  });

  it('does not throw on mismatched lengths', () => {
    // timingSafeEqual throws when its inputs differ in length, and that throw
    // would itself be an oracle. Both sides are padded first.
    expect(() => tokensMatch('a', TOKEN)).not.toThrow();
    expect(tokensMatch('a', TOKEN)).toBe(false);
  });

  it('rejects non-strings rather than coercing them', () => {
    for (const value of [undefined, null, 0, {}, []]) {
      expect(tokensMatch(value as never, TOKEN)).toBe(false);
    }
  });

  it('is not fooled by a token that is a prefix padded to the same length', () => {
    expect(tokensMatch('a'.repeat(63) + '\0', TOKEN)).toBe(false);
  });

  it('distinguishes long tokens that share a 64-character prefix', () => {
    // Regression. The first implementation padded to 64 characters and sliced,
    // so anything past character 64 was discarded and two different tokens of
    // the same length compared equal — an authentication bypass for any token
    // longer than 64 characters, which is exactly what `openssl rand -hex 48`
    // produces.
    const shared = 'a'.repeat(64);
    expect(tokensMatch(`${shared}XXXXXX`, `${shared}YYYYYY`)).toBe(false);
    expect(tokensMatch(`${shared}XXXXXX`, `${shared}XXXXXX`)).toBe(true);
  });

  it('handles multibyte characters instead of throwing', () => {
    // Regression. Slicing counted characters while timingSafeEqual compares
    // bytes, so any non-ASCII token threw "Input buffers must have the same
    // byte length" — a crash on the authentication path.
    const multibyte = 'é'.repeat(40) + 'a'.repeat(24);
    expect(() => tokensMatch(multibyte, TOKEN)).not.toThrow();
    expect(tokensMatch(multibyte, TOKEN)).toBe(false);
    expect(tokensMatch(multibyte, multibyte)).toBe(true);
  });

  it('compares the whole token however long it is', () => {
    const long = 'z'.repeat(500);
    expect(tokensMatch(long, long)).toBe(true);
    expect(tokensMatch(long, `${long}z`)).toBe(false);
  });
});

describe('readCookies', () => {
  it('finds the session cookie among others', () => {
    expect(readCookies(`theme=dark; ${SESSION_COOKIE}=xyz; other=1`, SESSION_COOKIE)).toEqual([
      'xyz',
    ]);
  });

  it('returns every value sent under the name, not just the first', () => {
    // Cookies are not unique by name, and RFC 6265 sends the longer-Path one
    // first. A first-match-wins reader let anyone who could set a cookie on
    // this origin plant `sairios_access=junk; Path=/broker` and lock the user
    // out of the paths that matter, unfixable by signing in again.
    expect(
      readCookies(`${SESSION_COOKIE}=planted; ${SESSION_COOKIE}=real`, SESSION_COOKIE),
    ).toEqual(['planted', 'real']);
  });

  it('does not match a cookie whose name merely ends the same way', () => {
    expect(readCookies(`not_sairios_access=nope`, SESSION_COOKIE)).toEqual([]);
  });

  it('returns nothing for a missing or absent header', () => {
    expect(readCookies(undefined, SESSION_COOKIE)).toEqual([]);
    expect(readCookies('a=1', SESSION_COOKIE)).toEqual([]);
  });
});

describe('guard', () => {
  const access = { ok: true, required: true, token: TOKEN, loopback: false } as never;
  const open = { ok: true, required: false, token: '', loopback: true } as never;

  const url = (path: string) => new URL(path, 'http://host');

  it('lets everything through when no token is configured', () => {
    const res = fakeRes();
    expect(guard(req(), res as never, url('/broker/requests'), open, {})).toBe(false);
  });

  it('blocks a service route with no cookie', () => {
    const res = fakeRes();
    const handled = guard(req(), res as never, url('/broker/requests'), access, {});
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
  });

  it('blocks every service prefix, not just the shell', () => {
    // The whole reason for one origin is that one door covers all four.
    for (const path of ['/ctx/contexts', '/bridge/intentions', '/broker/requests', '/']) {
      const res = fakeRes();
      expect(guard(req(), res as never, url(path), access, {})).toBe(true);
      expect(res.ended).toBe(true);
    }
  });

  it('answers an API call with JSON and a browser with the sign-in page', () => {
    const api = fakeRes();
    guard(req(), api as never, url('/ctx/contexts'), access, {});
    expect(String(api.headers['content-type'])).toContain('application/json');

    const page = fakeRes();
    guard(req({ headers: { accept: 'text/html' } }), page as never, url('/some/route'), access, {});
    expect(String(page.headers['content-type'])).toContain('text/html');
    expect(page.statusCode).toBe(401);
  });

  it('lets a request through with the right cookie', () => {
    const res = fakeRes();
    const handled = guard(
      req({ headers: { cookie: `${SESSION_COOKIE}=${TOKEN}` } }),
      res as never,
      url('/broker/requests'),
      access,
      {},
    );
    expect(handled).toBe(false);
    expect(res.ended).toBe(false);
  });

  it('is not locked out by a planted duplicate cookie', () => {
    // The shadowing attack: a junk value arrives first, the real one second.
    const res = fakeRes();
    const handled = guard(
      req({ headers: { cookie: `${SESSION_COOKIE}=junk; ${SESSION_COOKIE}=${TOKEN}` } }),
      res as never,
      url('/broker/requests'),
      access,
      {},
    );
    expect(handled).toBe(false);
  });

  it('rejects a wrong cookie', () => {
    const res = fakeRes();
    expect(
      guard(
        req({ headers: { cookie: `${SESSION_COOKIE}=${'b'.repeat(64)}` } }),
        res as never,
        url('/broker/requests'),
        access,
        {},
      ),
    ).toBe(true);
    expect(res.statusCode).toBe(401);
  });

  it('answers /healthz itself rather than letting the app fall through', () => {
    // It is public so a supervisor needs no credential — but letting it fall
    // through hit the single-page fallback and returned the whole shell HTML
    // to anyone who asked.
    const res = fakeRes();
    expect(guard(req(), res as never, url('/healthz'), access, {})).toBe(true);
    expect(String(res.headers['content-type'])).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ service: 'shell', status: 'ok' });
  });

  it('does not treat a path that merely starts with /access as public', () => {
    // `/accessible-data` must not slip past on a prefix match.
    const res = fakeRes();
    expect(guard(req(), res as never, url('/accessible-data'), access, {})).toBe(true);
  });
});
