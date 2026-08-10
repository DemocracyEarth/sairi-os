/**
 * The front door.
 *
 * SairiOS's services have no authentication, by design and by ADR: they bind
 * loopback and trust that only the local user can reach them.
 * [ADR 0011](../../docs/adr/0011-same-origin-service-proxy.md) put all four
 * surfaces on one origin, which made a single authenticated entrance
 * *possible*. This is that entrance.
 *
 * ---------------------------------------------------------------------------
 * The interlock is the point, not the token
 * ---------------------------------------------------------------------------
 * A token that an operator has to remember to switch on is a token that is off
 * on the machine where it mattered. So the rule is inverted: **binding
 * anywhere other than loopback without a token is a startup error**. There is
 * no flag to override it and no warning-and-continue path, because
 * "warn loudly" is what the tree did before and a warning scrolls past.
 *
 * SECURITY.md states remote access as an ordered precondition — authenticate
 * the decision route, make grants revocable, then transport. This is step one,
 * and it is deliberately impossible to skip.
 *
 * ---------------------------------------------------------------------------
 * What this is and is not
 * ---------------------------------------------------------------------------
 * It is a bearer token for a single-user machine: whoever holds it is the user.
 * That is the same model code-server and Gitpod use, and it is honest for a
 * personal operating environment.
 *
 * It is NOT multi-user, not per-context, and not a defence against someone who
 * already has code execution on the box — an agent there can reach 7801-7803
 * directly and this never sees it. SECURITY.md's threat model says the local
 * machine is trusted; this defends the network edge, which is the boundary that
 * remote access actually creates.
 *
 * It is also not a substitute for TLS. A bearer token over plain http on an
 * untrusted network is readable in transit. The transport must carry the
 * encryption — a tunnel, an overlay network, or a TLS-terminating proxy on the
 * same host. `requireSecureCookie` exists so the cookie says so.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** The cookie the browser gets back once it has proved it holds the token. */
export const SESSION_COOKIE = 'sairios_access';

/**
 * Paths served before authentication.
 *
 * Deliberately tiny. `/healthz` so a supervisor can check liveness without a
 * credential, and the sign-in page plus the single asset it needs. Everything
 * else — including every service prefix — is behind the door.
 */
const PUBLIC_PATHS = new Set(['/healthz', '/access', '/access/session']);

/**
 * Answers `/healthz` here rather than letting it fall through.
 *
 * It is on the public list so a supervisor can check liveness without a
 * credential — but the static handler has no such file, so it hit the
 * single-page fallback and returned the entire shell bundle's HTML,
 * unauthenticated, to anyone who asked. The exemption was meant to expose a
 * liveness bit and exposed the app instead.
 */
function health(res) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify({ service: 'shell', status: 'ok' }));
  return true;
}

/**
 * Compares two tokens without leaking length or position through timing.
 *
 * `timingSafeEqual` throws when its inputs differ in byte length, and that
 * throw would itself be an oracle, so both sides are reduced to a SHA-256
 * digest first: always 32 bytes, whatever the input.
 *
 * An earlier version padded to 64 characters and truncated instead, and it was
 * wrong twice. Slicing to 64 CHARACTERS made two different tokens sharing a
 * 64-character prefix compare equal — an authentication bypass for any token
 * longer than 64 — and because `TextEncoder` emits a variable number of bytes
 * per character, a token containing any multibyte character produced buffers of
 * different byte lengths and threw the very error the padding was there to
 * avoid. Hashing removes both: the digest is fixed-width, so there is nothing
 * to pad, nothing to truncate, and no length to compare afterwards.
 */
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Every value sent under `name`, not just the first.
 *
 * Cookies are not unique by name. A party who can set a cookie on this origin
 * can plant `sairios_access=junk; Path=/broker`, and RFC 6265 §5.4 has the
 * browser send the longer-Path cookie first — so a first-match-wins parser
 * reads the planted value, the real one is never examined, and the user is
 * locked out of exactly the paths that matter. Re-authenticating does not clear
 * it, because the exchange sets `Path=/` and never overwrites `Path=/broker`.
 *
 * Returning all of them turns that from a lockout into a no-op.
 */
export function readCookies(header, name) {
  if (typeof header !== 'string') return [];
  const found = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) found.push(part.slice(eq + 1).trim());
  }
  return found;
}

/**
 * Decides whether the front door is required, and refuses unsafe combinations.
 *
 * Returns `{ ok: false, message }` rather than throwing so the caller can print
 * a usable sentence and exit non-zero, which is what an operator needs at 2am.
 */
export function resolveAccess({ token, bindHost }) {
  const loopback = bindHost === '127.0.0.1' || bindHost === '::1' || bindHost === 'localhost';
  const trimmed = typeof token === 'string' ? token.trim() : '';

  if (!loopback && !trimmed) {
    return {
      ok: false,
      message:
        `refusing to bind ${bindHost} with no access token.\n\n` +
        '  SairiOS services have no authentication of their own. Off loopback,\n' +
        '  this process is the only thing between the network and a permission\n' +
        '  broker that executes privileged actions.\n\n' +
        '  Set one and try again:\n' +
        '      SAIRIOS_ACCESS_TOKEN="$(openssl rand -hex 32)"\n\n' +
        '  Or keep it on loopback and reach it through a tunnel:\n' +
        '      ./vm/qemu/tunnel.sh',
    };
  }

  // A token short enough to guess is worse than none, because it looks like
  // security. 32 hex characters is 128 bits.
  if (trimmed && trimmed.length < 32) {
    return {
      ok: false,
      message:
        'the access token is too short. Use at least 32 characters:\n' +
        '      SAIRIOS_ACCESS_TOKEN="$(openssl rand -hex 32)"',
    };
  }

  // The token becomes a cookie value, and a cookie value becomes a header.
  // Node throws ERR_INVALID_CHAR on a header containing anything outside
  // latin-1, so a token with, say, a CJK character used to take the process
  // down from inside a request handler — a crash on the authentication path,
  // triggered by configuration. Refuse it at startup instead, where the
  // operator can read why. The excluded ASCII is what RFC 6265 forbids in a
  // cookie-value.
  // RFC 6265 cookie-octet, written in hex because the same set spelled with
  // literal characters needs `]`, `-` and `\` escaped inside a class and is
  // extremely easy to get subtly wrong — the first attempt was.
  if (trimmed && !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(trimmed)) {
    return {
      ok: false,
      message:
        'the access token contains characters that cannot go in a cookie.\n' +
        '  Use printable ASCII without spaces, commas, semicolons, backslashes\n' +
        '  or quotes — a hex or base64 token is always safe:\n' +
        '      SAIRIOS_ACCESS_TOKEN="$(openssl rand -hex 32)"',
    };
  }

  return {
    ok: true,
    // A token on loopback is allowed and enforced — useful for testing the real
    // path — but it is not required there.
    required: Boolean(trimmed),
    token: trimmed,
    loopback,
  };
}

/**
 * Guards one request.
 *
 * Returns true when it has answered the request itself and the caller must stop.
 */
export function guard(req, res, url, access, { secureCookie }) {
  if (!access.required) return false;

  if (PUBLIC_PATHS.has(url.pathname)) {
    if (url.pathname === '/access/session') return exchange(req, res, access, { secureCookie });
    if (url.pathname === '/access') return signInPage(res);
    return health(res);
  }

  // Any one of them matching is enough; see readCookies for why there can be
  // more than one.
  if (readCookies(req.headers.cookie, SESSION_COOKIE).some((c) => tokensMatch(c, access.token))) {
    return false;
  }

  // A browser asking for a page gets the sign-in page; anything else gets a
  // 401 it can act on. Redirecting an API call to HTML produces a JSON parse
  // error three layers away from the actual problem.
  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  if (wantsHtml && req.method === 'GET') return signInPage(res, 401);

  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify({ error: { code: 'unauthorised', message: 'Access token required.' } }));
  return true;
}

function exchange(req, res, access, { secureCookie }) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return true;
  }

  // Buffers collected and decoded once at the end, rather than `body += chunk`.
  // Coercing each chunk decodes it in isolation, so a multibyte character split
  // across a TCP boundary becomes replacement characters and a perfectly good
  // passphrase silently stops matching depending on how the network fragmented
  // it. Bytes are also what the 4 KiB cap should be counting.
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    // A sign-in body is a token. Anything larger is someone probing.
    if (size > 4096) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    let token;
    try {
      token = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.token;
    } catch {
      token = undefined;
    }

    if (!tokensMatch(token, access.token)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'unauthorised', message: 'Wrong token.' } }));
      return;
    }

    // HttpOnly so a successful script injection cannot read it; SameSite=Strict
    // so a cross-site request cannot ride it, which is what stands in for CSRF
    // tokens on the state-changing service routes behind this door.
    const flags = [
      `${SESSION_COOKIE}=${access.token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=604800',
    ];
    if (secureCookie) flags.push('Secure');

    res.writeHead(204, { 'set-cookie': flags.join('; ') });
    res.end();
  });
  return true;
}

/**
 * The sign-in page, inline and dependency-free.
 *
 * Served by the same process that owns the token and before any bundle is
 * reachable, so it cannot be a React route inside the shell.
 *
 * It carries its own Content Security Policy, and it has to: the shell's policy
 * lives in a `<meta>` tag inside `dist/index.html`, which is a different
 * document and does not apply here. Without this header the one page that
 * handles a credential would be the only unprotected page in the system.
 *
 * The policy is stricter than the shell's — `default-src 'none'`, no images, no
 * fonts, and `script-src` limited to the exact SHA-256 of the one inline script
 * below. A hash rather than `'unsafe-inline'` so that an injected script cannot
 * run even if this page ever grows a way to inject one, and rather than a nonce
 * because the content is static and a hash needs no per-request state.
 */
const SIGN_IN_SCRIPT = `document.forms[0].addEventListener('submit',async e=>{e.preventDefault();const t=e.target.token.value;const r=await fetch('/access/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:t})});if(r.ok)location.href='/';else document.getElementById('err').textContent='That token was not accepted.';});`;

/** Computed once at load; the script is a constant. */
const SCRIPT_HASH = `sha256-${createHash('sha256').update(SIGN_IN_SCRIPT, 'utf8').digest('base64')}`;

const SIGN_IN_CSP = [
  "default-src 'none'",
  `script-src '${SCRIPT_HASH}'`,
  "style-src 'unsafe-inline'",
  // The page's only outbound request is the token exchange, to itself.
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function signInPage(res, status = 200) {
  const script = SIGN_IN_SCRIPT;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SairiOS — access</title>
<style>
/* The door, in the same language as the room behind it.
 *
 * This page used to be dark navy with a violet button — the spectral palette
 * the shell left behind — which made the first thing a remote operator saw the
 * one screen that looked like a different product.
 *
 * Two constraints shape how far it can go, and both are deliberate:
 *
 *   No webfonts. The vendored faces live at content-hashed /assets paths behind
 *   this very door, so an unauthenticated page cannot load them, and widening
 *   PUBLIC_PATHS with a prefix rule to serve typography would trade a real
 *   boundary for a nicer heading. A system stack it is.
 *
 *   No token import. This page is a string in a Node script, not part of the
 *   Vite build, so the values are literals. tokens.test.ts asserts they still
 *   match tokens.css — the copy is checked rather than trusted.
 *
 * A prefers-color-scheme block IS correct here, unlike in tokens.css: there is
 * no JavaScript to resolve a preference before paint. Same reasoning as
 * os/branding/palette.css, which keeps its media query for the same reason.
 */
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
 background:#f7f6f3;color:#17181a;
 font:15px/1.5 'Inter Tight',Inter,ui-sans-serif,-apple-system,system-ui,sans-serif}
form{width:min(100%,380px);padding:28px;border:1px solid rgb(23 24 26 / 14%);
 border-radius:6px;background:#ffffff}
h1{margin:0 0 6px;font-size:19px;font-weight:600;letter-spacing:-0.02em}
p{margin:0 0 18px;color:#63666b;font-size:13px}
label{display:block;margin-bottom:6px;font-size:12px;letter-spacing:0.06em;
 text-transform:uppercase;color:#6e7176}
input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:4px;
 border:1px solid rgb(23 24 26 / 14%);background:#f7f6f3;color:#17181a;font:inherit}
input:focus-visible{outline:2px solid #17181a;outline-offset:1px;border-color:transparent}
/* The accent, on the one control that is the machine waiting for a human.
   #a8491a rather than Braun's #d46c35: white on the latter is 3.50:1. */
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:4px;
 background:#a8491a;color:#ffffff;font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#8f3d15}
#err{margin:12px 0 0;color:#b4511f;font-size:13px;min-height:1em}
@media (prefers-color-scheme:dark){
 :root{color-scheme:dark}
 body{background:#17181a;color:#edece8}
 form{background:#202124;border-color:rgb(237 236 232 / 17%)}
 p{color:#9a9890}
 label{color:#84827b}
 input{background:#101113;color:#edece8;border-color:rgb(237 236 232 / 17%)}
 input:focus-visible{outline-color:#edece8}
 /* The fill is lighter than the ground here, so the label is ink, not white. */
 button{background:#ff9a63;color:#17181a}
 button:hover{background:#ffb184}
 #err{color:#f0733a}
}
</style></head><body><form>
<h1>SairiOS</h1>
<p>This machine is reachable over a network, so it asks for its access token.
It is the value of SAIRIOS_ACCESS_TOKEN on the host running SairiOS. It is
never logged or printed, so it has to come from wherever you stored it.</p>
<label for="token">Access token</label>
<input id="token" name="token" type="password" autocomplete="off" autofocus spellcheck="false">
<button type="submit">Unlock</button>
<p id="err"></p>
</form><script>${script}</script></body></html>`;

  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': SIGN_IN_CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    // A page that has just handled a credential must not sit in a shared cache.
    'cache-control': 'no-store',
  });
  res.end(html);
  return true;
}
