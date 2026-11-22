import { describe, expect, it, vi } from 'vitest';
import { sanitizeReturnTo } from '../../src/server/app';
import { ApiError } from '../../src/server/errors';
import { withErrors } from '../../src/server/middleware';
import { makeHarness } from './harness';

const loc = (r: Response) => new URL(r.headers.get('location')!);
const err = (r: Response) => loc(r).searchParams.get('auth_error');

describe('GET /api/auth/login', () => {
  it('redirects to GitHub with state + PKCE S256 and sets a sealed, HttpOnly, Secure state cookie', async () => {
    const h = await makeHarness();
    const r = await h.call('/api/auth/login', { site: 'none' });
    expect(r.status).toBe(302);
    const u = loc(r);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://zipora.test/api/auth/callback');
    expect(u.searchParams.get('scope')).toBe('repo');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')!.length).toBeGreaterThanOrEqual(40);
    expect(u.searchParams.has('client_secret')).toBe(false);
    const cookie = r.headers.getSetCookie()[0];
    expect(cookie).toMatch(/^__Host-zipora_oauth=v1\./);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) expect(cookie).toContain(a);
    expect(cookie).not.toContain(u.searchParams.get('state')!); // state is inside the ciphertext, not readable
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('uses fresh state and verifier for each attempt', async () => {
    const h = await makeHarness();
    const a = loc(await h.call('/api/auth/login')).searchParams.get('state');
    const b = loc(await h.call('/api/auth/login')).searchParams.get('state');
    expect(a).not.toBe(b);
  });
  it('rejects non-GET', async () => {
    const h = await makeHarness();
    const r = await h.call('/api/auth/login', { method: 'POST' });
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET');
  });
});

describe('GET /api/auth/callback — success path', () => {
  it('creates an encrypted session, consumes the state cookie and redirects to the dashboard', async () => {
    const h = await makeHarness();
    const { cb } = await h.signIn();
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('https://zipora.test/dashboard');
    const cookies = cb.headers.getSetCookie();
    expect(cookies).toHaveLength(2); // state cookie cleared + session set
    expect(cookies.find((c) => c.startsWith('__Host-zipora_oauth='))).toContain('Max-Age=0');
    const session = cookies.find((c) => c.startsWith('__Host-zipora_session='))!;
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(session).toContain(a);
    expect(session).toMatch(/Max-Age=604800/);
    expect(session).not.toContain('Domain');
    // The token and the username are only inside the ciphertext.
    const issued = h.oauth.state.issued[0];
    const raw = decodeURIComponent(session.split(';')[0].split('=').slice(1).join('='));
    expect(raw).not.toContain(issued);
    expect(Buffer.from(raw.split('.')[2], 'base64url').toString('latin1')).not.toContain('octo-dev');
    expect(h.jar.cookies.has('__Host-zipora_oauth')).toBe(false);
  });
  it('exchanged the code with the client secret and the PKCE verifier (server-side only)', async () => {
    const h = await makeHarness();
    await h.signIn();
    const exchange = h.oauth.log.find((l) => l.path === '/login/oauth/access_token')!;
    expect(exchange.body).toMatchObject({ client_id: 'cid123', client_secret: 'csecret-value-456', redirect_uri: 'https://zipora.test/api/auth/callback' });
    expect(exchange.body.code_verifier).toBeTruthy();
  });
  it('honours a safe returnTo and ignores hostile ones', async () => {
    const h = await makeHarness();
    expect((await h.signIn('/new?step=2')).cb.headers.get('location')).toBe('https://zipora.test/new?step=2');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/api/auth/logout', '/%0d%0aX: y', 'evil.com']) {
      expect(sanitizeReturnTo(bad, 'https://zipora.test')).toBe('/dashboard');
    }
    const h2 = await makeHarness();
    expect((await h2.signIn('//evil.com')).cb.headers.get('location')).toBe('https://zipora.test/dashboard');
  });
  it('works for GitHub App style tokens (no scope requested)', async () => {
    const h = await makeHarness({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { grantedScope: '', expiring: true } });
    const { login, cb } = await h.signIn();
    expect(loc(login).searchParams.has('scope')).toBe(false);
    expect(cb.headers.get('location')).toBe('https://zipora.test/dashboard');
  });
});

describe('GET /api/auth/callback — failures never create a session', () => {
  const noSession = (h: Awaited<ReturnType<typeof makeHarness>>, r: Response) => {
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-zipora_session=') && !c.includes('Max-Age=0'))).toBe(false);
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
  };
  it('state mismatch (CSRF/login-CSRF)', async () => {
    const h = await makeHarness();
    const login = await h.call('/api/auth/login');
    const { callback } = h.oauth.authorize(login.headers.get('location')!);
    callback.searchParams.set('state', 'attacker-chosen-state');
    const r = await h.call(callback.pathname + callback.search, { site: 'cross-site' });
    expect(err(r)).toBe('OAUTH_STATE_INVALID');
    noSession(h, r);
    expect(h.oauth.log.some((l) => l.path === '/login/oauth/access_token')).toBe(false); // code never exchanged
  });
  it('missing state cookie (attacker-initiated callback)', async () => {
    const h = await makeHarness();
    const login = await h.call('/api/auth/login');
    const { callback } = h.oauth.authorize(login.headers.get('location')!);
    h.jar.cookies.clear();
    expect(err(await h.call(callback.pathname + callback.search, { site: 'cross-site' }))).toBe('OAUTH_STATE_INVALID');
  });
  it('replay of a used callback URL', async () => {
    const h = await makeHarness();
    const { callback } = await h.signIn();
    h.jar.cookies.clear();
    expect(err(await h.call(callback.pathname + callback.search, { site: 'cross-site' }))).toBe('OAUTH_STATE_INVALID');
  });
  it('state cookie expires after 10 minutes', async () => {
    const h = await makeHarness();
    const login = await h.call('/api/auth/login');
    const { callback } = h.oauth.authorize(login.headers.get('location')!);
    h.clock.t += 601;
    expect(err(await h.call(callback.pathname + callback.search, { site: 'cross-site' }))).toBe('OAUTH_STATE_INVALID');
  });
  it('user denies access / GitHub reports an error / code missing', async () => {
    const h = await makeHarness();
    for (const [q, code] of [['error=access_denied', 'ACCESS_DENIED'], ['error=server_error', 'OAUTH_ERROR'], ['', 'OAUTH_CODE_MISSING']] as const) {
      const login = await h.call('/api/auth/login');
      const { callback } = h.oauth.authorize(login.headers.get('location')!);
      callback.searchParams.delete('code');
      for (const part of q ? q.split('&') : []) callback.searchParams.set(...(part.split('=') as [string, string]));
      expect(err(await h.call(callback.pathname + callback.search, { site: 'cross-site' }))).toBe(code);
    }
  });
  it('invalid/forged authorization code', async () => {
    const h = await makeHarness();
    const login = await h.call('/api/auth/login');
    const { callback } = h.oauth.authorize(login.headers.get('location')!);
    callback.searchParams.set('code', 'forged-code');
    const r = await h.call(callback.pathname + callback.search, { site: 'cross-site' });
    expect(err(r)).toBe('INVALID_CODE');
    noSession(h, r);
  });
  it('insufficient scope: rejected and the token is revoked, not left live', async () => {
    const h = await makeHarness({ oauth: { grantedScope: 'read:user' } });
    const { cb } = await h.signIn();
    expect(err(cb)).toBe('INSUFFICIENT_SCOPE');
    noSession(h, cb);
    expect(h.oauth.accessTokens.size).toBe(0);
  });
  it('misconfigured OAuth app credentials', async () => {
    const h = await makeHarness({ env: { GITHUB_CLIENT_SECRET: 'wrong-but-long-secret' }, oauth: { clientSecret: 'the-real-secret' } });
    expect(err((await h.signIn()).cb)).toBe('OAUTH_MISCONFIGURED');
  });
  it('GitHub unreachable / token rejected on profile fetch', async () => {
    const h = await makeHarness();
    h.oauth.state.failNetwork = true;
    expect(err((await h.signIn()).cb)).toBe('GITHUB_UNREACHABLE');
    const h2 = await makeHarness();
    h2.oauth.state.rejectUser = true;
    expect(err((await h2.signIn()).cb)).toBe('TOKEN_INVALID');
  });
});

describe('GET /api/auth/session', () => {
  it('signed out → authenticated:false', async () => {
    const h = await makeHarness();
    expect(await (await h.call('/api/auth/session')).json()).toEqual({ authenticated: false });
  });
  it('signed in → user + CSRF token + expiry, and never the access token', async () => {
    const h = await makeHarness();
    await h.signIn();
    const r = await h.call('/api/auth/session');
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ authenticated: true, user: { login: 'octo-dev', id: 4242 }, scope: 'repo', tokenExpiresAt: null });
    expect(body.csrfToken.length).toBeGreaterThan(20);
    expect(text).not.toContain(h.oauth.state.issued[0]);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('tampered, wrong-purpose and expired cookies are rejected and cleared', async () => {
    const h = await makeHarness();
    await h.signIn();
    const good = h.jar.cookies.get('__Host-zipora_session')!;
    h.jar.cookies.set('__Host-zipora_session', good.slice(0, -3) + (good.endsWith('AAA') ? 'BBB' : 'AAA'));
    let r = await h.call('/api/auth/session');
    expect(await r.json()).toEqual({ authenticated: false, reason: 'invalid' });
    expect(r.headers.getSetCookie()[0]).toContain('Max-Age=0');

    // A (validly sealed) OAuth-state cookie must not work as a session.
    const login = await h.call('/api/auth/login');
    h.jar.cookies.set('__Host-zipora_session', h.jar.cookies.get('__Host-zipora_oauth')!);
    expect(await (await h.call('/api/auth/session')).json()).toEqual({ authenticated: false, reason: 'invalid' });
    expect(login.status).toBe(302);

    const h2 = await makeHarness();
    await h2.signIn();
    h2.clock.t += h2.config.sessionTtlSeconds + 1;
    expect(await (await h2.call('/api/auth/session')).json()).toEqual({ authenticated: false, reason: 'expired' });
    expect(h2.jar.cookies.has('__Host-zipora_session')).toBe(false);
  });
  it('?verify=1 detects a token revoked on GitHub and signs the user out', async () => {
    const h = await makeHarness();
    await h.signIn();
    expect((await (await h.call('/api/auth/session?verify=1')).json()).authenticated).toBe(true);
    h.oauth.accessTokens.clear();
    expect(await (await h.call('/api/auth/session?verify=1')).json()).toEqual({ authenticated: false, reason: 'token_revoked' });
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
  });
  it('refuses cross-site and foreign-origin requests', async () => {
    const h = await makeHarness();
    await h.signIn();
    expect((await h.call('/api/auth/session', { site: 'cross-site' })).status).toBe(403);
    expect((await h.call('/api/auth/session', { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('POST /api/auth/logout', () => {
  it('requires the CSRF token; a forged cross-site logout does nothing', async () => {
    const h = await makeHarness();
    await h.signIn();
    for (const init of [{}, { csrf: 'wrong-token' }]) {
      const r = await h.call('/api/auth/logout', { method: 'POST', ...init });
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe('CSRF_INVALID');
    }
    expect((await h.call('/api/auth/logout', { method: 'POST', site: 'cross-site' })).status).toBe(403);
    expect((await h.call('/api/auth/logout', { method: 'POST', origin: 'https://evil.example' })).status).toBe(403);
    expect((await (await h.call('/api/auth/session')).json()).authenticated).toBe(true); // still signed in
  });
  it('clears the cookie and revokes the token at GitHub with the client credentials', async () => {
    const h = await makeHarness();
    await h.signIn();
    const token = h.oauth.state.issued[0];
    const r = await h.call('/api/auth/logout', { method: 'POST', csrf: await h.csrf() });
    expect(await r.json()).toEqual({ ok: true, revoked: true });
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-zipora_session=') && c.includes('Max-Age=0'))).toBe(true);
    expect(h.oauth.accessTokens.has(token)).toBe(false);
    const del = h.oauth.log.find((l) => l.method === 'DELETE')!;
    expect(del.headers.authorization).toBe(`Basic ${Buffer.from('cid123:csecret-value-456').toString('base64')}`);
    expect((await (await h.call('/api/auth/session')).json()).authenticated).toBe(false);
  });
  it('is idempotent when already signed out, and rejects GET', async () => {
    const h = await makeHarness();
    expect(await (await h.call('/api/auth/logout', { method: 'POST' })).json()).toEqual({ ok: true, revoked: false });
    const g = await h.call('/api/auth/logout');
    expect(g.status).toBe(405);
    expect(g.headers.get('allow')).toBe('POST');
  });
  it('still signs the user out locally if GitHub is unreachable', async () => {
    const h = await makeHarness();
    await h.signIn();
    const csrf = await h.csrf();
    h.oauth.state.failNetwork = true;
    expect(await (await h.call('/api/auth/logout', { method: 'POST', csrf })).json()).toEqual({ ok: true, revoked: false });
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
  });
});

describe('error handling', () => {
  it('unknown routes return a structured 404', async () => {
    const h = await makeHarness();
    const r = await h.call('/api/auth/nope');
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('NOT_FOUND');
  });
  it('unexpected exceptions become a generic 500 and a redacted log line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await makeHarness();
    const handler = withErrors(h.config, async () => { throw new Error(`boom with gho_${'q7'.repeat(12)} and csecret-value-456`); });
    const r = await handler(new Request('https://zipora.test/x'));
    const logged = String(spy.mock.calls[0][0]);
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/boom|gho_|csecret/);
    expect(logged).not.toMatch(/gho_[a-z0-9]{6}|csecret-value-456/);
  });
  it('ApiError carries code, hint and status', async () => {
    const h = await makeHarness();
    const r = await withErrors(h.config, async () => { throw new ApiError(418, 'TEAPOT', 'short and stout', { hint: 'tip me over' }); })(new Request('https://zipora.test/x'));
    expect(r.status).toBe(418);
    expect(await r.json()).toEqual({ error: { code: 'TEAPOT', message: 'short and stout', hint: 'tip me over' } });
  });
});
