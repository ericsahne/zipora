import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness';

const signedIn = async (opts: Parameters<typeof makeHarness>[0] = {}) => { const h = await makeHarness(opts); await h.signIn(); return h; };
const jsonPost = (h: Harness, path: string, body: unknown, extra: Record<string, unknown> = {}) =>
  h.call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...extra });
const upstream = (h: Harness) => h.oauth.log.filter((l) => l.host === 'api.github.com' && l.path !== '/user' || l.path === '/user' && l.headers['user-agent'] === 'ZIPORA');
const code = async (r: Response) => (await r.json()).error.code;

describe('authentication middleware on /api/github', () => {
  it('401 without a session, 401 + cleared cookie for a bad one', async () => {
    const h = await makeHarness();
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(401);
    expect(await code(r)).toBe('UNAUTHENTICATED');
    h.jar.cookies.set('__Host-zipora_session', 'v1.garbage.garbage');
    const r2 = await h.call('/api/github/user');
    expect(await code(r2)).toBe('SESSION_INVALID');
    expect(r2.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect(h.oauth.log.some((l) => l.host === 'api.github.com')).toBe(false); // nothing reached GitHub
  });
  it('expired session → 401 SESSION_EXPIRED', async () => {
    const h = await signedIn();
    h.clock.t += h.config.sessionTtlSeconds + 1;
    expect(await code(await h.call('/api/github/user'))).toBe('SESSION_EXPIRED');
  });
  it('rejects cross-site and foreign-origin requests, even GETs', async () => {
    const h = await signedIn();
    expect(await code(await h.call('/api/github/user', { site: 'cross-site' }))).toBe('CROSS_SITE_REQUEST');
    expect(await code(await h.call('/api/github/user', { origin: 'https://evil.example' }))).toBe('BAD_ORIGIN');
  });
  it('state-changing calls need the CSRF token; GETs do not', async () => {
    const h = await signedIn();
    expect((await h.call('/api/github/user')).status).toBe(200);
    const bad = await jsonPost(h, '/api/github/repos/o/r/git/blobs', { content: 'aGk=', encoding: 'base64' });
    expect(bad.status).toBe(403);
    expect(await code(bad)).toBe('CSRF_INVALID');
    const wrong = await jsonPost(h, '/api/github/repos/o/r/git/blobs', { content: 'aGk=', encoding: 'base64' }, { csrf: 'nope' });
    expect(wrong.status).toBe(403);
    const ok = await jsonPost(h, '/api/github/repos/o/r/git/blobs', { content: 'aGk=', encoding: 'base64' }, { csrf: await h.csrf() });
    expect(ok.status).toBe(201);
  });
  it("a CSRF token from one session is useless in another", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const tokenA = await a.csrf();
    const r = await jsonPost(b, '/api/github/repos/o/r/git/blobs', { content: 'aGk=', encoding: 'base64' }, { csrf: tokenA });
    expect(r.status).toBe(403);
  });
});

describe('proxy: token handling', () => {
  it('attaches the real token server-side and drops every client-supplied credential', async () => {
    const h = await signedIn();
    const r = await h.call('/api/github/user', { headers: { authorization: 'Bearer attacker-token', 'x-forwarded-for': '6.6.6.6', 'x-api-key': 'k' } });
    expect(r.status).toBe(200);
    const sent = h.oauth.log.filter((l) => l.host === 'api.github.com').at(-1)!;
    expect(sent.headers.authorization).toBe(`Bearer ${h.oauth.state.issued[0]}`);
    expect(sent.headers.cookie).toBeUndefined();
    expect(sent.headers['x-forwarded-for']).toBeUndefined();
    expect(sent.headers['x-api-key']).toBeUndefined();
    expect(sent.headers['user-agent']).toBe('ZIPORA');
  });
  it('never returns the token or upstream cookies/unknown headers to the browser', async () => {
    const h = await signedIn();
    h.oauth.git.onRequest = () => new Response('{"ok":true}', { status: 200, headers: { 'set-cookie': 'evil=1', 'x-custom-secret': 's', 'x-ratelimit-remaining': '42', etag: '"abc"', 'content-type': 'application/json' } });
    const r = await h.call('/api/github/repos/o/r');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('x-custom-secret')).toBeNull();
    expect(r.headers.get('x-ratelimit-remaining')).toBe('42');
    expect(r.headers.get('etag')).toBe('"abc"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    expect(text).not.toContain(h.oauth.state.issued[0]);
  });
  it('rewrites pagination Link headers to stay on the proxy', async () => {
    const h = await signedIn();
    h.oauth.git.onRequest = () => new Response('[]', { status: 200, headers: { link: '<https://api.github.com/repos/o/r/branches?page=2>; rel="next"' } });
    const r = await h.call('/api/github/repos/o/r/branches?per_page=100');
    expect(r.headers.get('link')).toBe('<https://zipora.test/api/github/repos/o/r/branches?page=2>; rel="next"');
  });
  it('an upstream 401 (token revoked) also clears the session cookie', async () => {
    const h = await signedIn();
    h.oauth.accessTokens.clear();
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(401);
    expect(r.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
  });
  it('passes GitHub error statuses and rate-limit headers through unchanged', async () => {
    const h = await signedIn();
    h.oauth.git.onRequest = () => new Response('{"message":"rate limited"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999', 'retry-after': '30', 'content-type': 'application/json' } });
    const r = await h.call('/api/github/repos/o/r');
    expect(r.status).toBe(403);
    expect(r.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(r.headers.get('retry-after')).toBe('30');
  });
  it('reports unreachable GitHub as 502', async () => {
    const h = await signedIn();
    h.oauth.state.failNetwork = true;
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(502);
    expect(await code(r)).toBe('UPSTREAM_UNREACHABLE');
  });
});

describe('proxy: allow-list', () => {
  it.each([
    '/api/github/orgs/acme/members', '/api/github/user/emails', '/api/github/applications/cid123/token',
    '/api/github/repos/o/r/collaborators', '/api/github/repos/o/r/actions/secrets', '/api/github/graphql', '/api/github/',
  ])('refuses %s', async (path) => {
    const h = await signedIn();
    const r = await h.call(path);
    expect([403, 404]).toContain(r.status);
    expect(h.oauth.log.some((l) => l.host === 'api.github.com' && l.path !== '/user')).toBe(false);
  });
  it('enforces the method per endpoint (no DELETE of repos or refs)', async () => {
    const h = await signedIn();
    const csrf = await h.csrf();
    for (const [method, path] of [['DELETE', '/api/github/repos/o/r'], ['DELETE', '/api/github/repos/o/r/git/refs/heads/main'], ['PUT', '/api/github/user'], ['GET', '/api/github/repos/o/r/git/blobs']]) {
      const r = await h.call(path, { method, csrf, headers: { 'content-type': 'application/json' } });
      expect(r.status, `${method} ${path}`).toBe(405);
    }
  });
  it('allows every method an endpoint legitimately has (regression: POST /user/repos was rejected as GET-only)', async () => {
    const h = await signedIn();
    const csrf = await h.csrf();
    expect((await h.call('/api/github/user/repos')).status).toBe(200);
    const created = await jsonPost(h, '/api/github/user/repos', { name: 'made-here', private: true, auto_init: true }, { csrf });
    expect(created.status).toBe(201);
    expect(h.oauth.repos.map((r) => r.name)).toContain('made-here');
    const del = await h.call('/api/github/user/repos', { method: 'DELETE', csrf });
    expect(del.status).toBe(405);
    expect(del.headers.get('allow')).toBe('GET, POST');
  });
  it('blocks path tricks: encoded traversal, backslashes, empty segments', async () => {
    const h = await signedIn();
    for (const p of ['/api/github/repos/o/r/git/ref/heads/a%2F..%2F..%2Fx', '/api/github/repos/o/r/git/ref/heads/a%5Cb', '/api/github/repos/o/r/git/ref/heads/a%2F%2Fb', '/api/github/repos/o%2Fx/r']) {
      const r = await h.call(p);
      expect([400, 403], p).toContain(r.status);
    }
    expect(h.oauth.log.some((l) => l.path.includes('..'))).toBe(false);
  });
  it('only allows known query parameters with safe values', async () => {
    const h = await signedIn();
    expect((await h.call('/api/github/user/repos?per_page=100&page=2&affiliation=owner,collaborator')).status).toBe(200);
    expect(await code(await h.call('/api/github/user/repos?access_token=abc'))).toBe('BAD_QUERY');
    expect(await code(await h.call('/api/github/user/repos?per_page=1%26evil%3D1'))).toBe('BAD_QUERY');
  });
  it('requires JSON bodies and enforces the size cap', async () => {
    const h = await signedIn({ env: { PROXY_MAX_BODY_BYTES: '2000' } });
    const csrf = await h.csrf();
    const text = await h.call('/api/github/repos/o/r/git/blobs', { method: 'POST', csrf, headers: { 'content-type': 'text/plain' }, body: 'x' });
    expect(text.status).toBe(415);
    const big = await jsonPost(h, '/api/github/repos/o/r/git/blobs', { content: 'A'.repeat(5000), encoding: 'base64' }, { csrf });
    expect(big.status).toBe(413);
    expect(await code(big)).toBe('PAYLOAD_TOO_LARGE');
    expect(h.oauth.log.some((l) => l.path.endsWith('/git/blobs'))).toBe(false);
  });
});

describe('expiring tokens (GitHub App user tokens)', () => {
  const expiring = () => signedIn({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { grantedScope: '', expiring: true, expiresIn: 3600 } });
  const advanceToExpiry = (h: Harness) => { h.clock.t += 3600 - 100; }; // inside the 5-minute refresh window

  it('refreshes transparently, uses the new token upstream, and re-issues the cookie', async () => {
    const h = await expiring();
    const first = h.oauth.state.issued[0];
    advanceToExpiry(h);
    const before = h.jar.cookies.get('__Host-zipora_session');
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(200);
    expect(h.oauth.refreshCalls()).toBe(1);
    const second = h.oauth.state.issued[1];
    expect(second).not.toBe(first);
    expect(h.oauth.log.filter((l) => l.host === 'api.github.com').at(-1)!.headers.authorization).toBe(`Bearer ${second}`);
    expect(h.jar.cookies.get('__Host-zipora_session')).not.toBe(before);
    await h.call('/api/github/user');
    expect(h.oauth.refreshCalls()).toBe(1); // new cookie is fresh: no second refresh
  });
  it('concurrent requests share one refresh (refresh tokens are single-use)', async () => {
    const h = await expiring();
    advanceToExpiry(h);
    const rs = await Promise.all(Array.from({ length: 6 }, () => h.call('/api/github/user', { jar: Object.assign(Object.create(Object.getPrototypeOf(h.jar)), { cookies: new Map(h.jar.cookies), raw: [] }) })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(h.oauth.refreshCalls()).toBe(1);
  });
  it('/api/auth/session refreshes ahead of time and reports the new expiry', async () => {
    const h = await expiring();
    advanceToExpiry(h);
    const body = await (await h.call('/api/auth/session')).json();
    expect(body.authenticated).toBe(true);
    expect(body.tokenExpiresAt).toBe(h.clock.t + 3600);
    expect(h.oauth.refreshCalls()).toBe(1);
  });
  it('a refresh GitHub rejects ends the session cleanly (401 + cleared cookie)', async () => {
    const h = await expiring();
    advanceToExpiry(h);
    h.oauth.refreshTokens.clear();
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(401);
    expect(await code(r)).toBe('SESSION_EXPIRED');
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
    const h2 = await expiring();
    advanceToExpiry(h2);
    h2.oauth.refreshTokens.clear();
    expect(await (await h2.call('/api/auth/session')).json()).toEqual({ authenticated: false, reason: 'token_expired' });
  });
  it('without a refresh token: usable until it expires, then rejected', async () => {
    const h = await signedIn({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { grantedScope: '', expiring: true, expiresIn: 3600, omitRefresh: true } });
    h.clock.t += 3600 - 100; // inside the refresh window, but nothing to refresh with and still valid
    expect((await h.call('/api/github/user')).status).toBe(200);
    expect(h.oauth.refreshCalls()).toBe(0);
    h.clock.t += 200; // now actually expired
    const r = await h.call('/api/github/user');
    expect(r.status).toBe(401);
    expect(await code(r)).toBe('SESSION_EXPIRED');
  });
});
