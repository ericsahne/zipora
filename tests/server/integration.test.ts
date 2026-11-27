import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthClient, MAX_PROXIED_BODY_BYTES, maxProxiedFileBytes } from '../../src/client/auth';
import { bytesFile, EngineError, encodeBase64Bytes, executeDeployment, inspectZip } from '../../src/engine';
import { toNodeHandler } from '../../src/server/node';
import { getApp, vercelHandler } from '../../src/server/runtime';
import { makeHarness, type Harness } from './harness';
import JSZip from 'jszip';

const enc = new TextEncoder();
const target = { owner: 'o', repo: 'r', branch: 'main' };
const opts = { targetDir: '', replaceExisting: true, deleteMissing: false, message: 'Deploy via ZIPORA' };

/** Routes AuthClient's fetch into the app exactly as a browser would (cookies, Origin, Sec-Fetch-Site) and records what the browser sees. */
function browser(h: Harness) {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const res = await h.call(String(input), { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ?? undefined, csrf: new Headers(init?.headers).get('x-csrf-token') ?? undefined });
    seen.push([...res.headers.entries()].join('\n'), await res.clone().text());
    return res;
  };
  return { seen, auth: new AuthClient({ fetchImpl }) };
}

describe('Phase 1 deployment engine through the authenticated proxy', () => {
  it('deploys real files end to end; the browser never sees the token, GitHub only sees the server-attached one', async () => {
    const h = await makeHarness({ oauth: { gitFiles: { 'README.md': 'old', 'keep.txt': 'stay' } } });
    await h.signIn();
    const { auth, seen } = browser(h);
    expect((await auth.getSession()).authenticated).toBe(true);

    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/f${i}.txt`, `content ${i}`]));
    const files = Object.entries({ 'README.md': 'new', ...many }).map(([p, c]) => bytesFile(p, enc.encode(c)));
    const r = await executeDeployment({ client: auth.createGitHubClient(), target, files, options: opts, concurrency: 4 });

    expect(r.status).toBe('success');
    expect(r.counts).toMatchObject({ added: 12, updated: 1 });
    expect(h.oauth.git.files()).toMatchObject({ 'README.md': 'new', 'keep.txt': 'stay', 'src/f7.txt': 'content 7' });
    expect(h.oauth.git.count('POST', '/git/commits')).toBe(1);

    const token = h.oauth.state.issued[0];
    const gitCalls = h.oauth.log.filter((l) => l.host === 'api.github.com' && l.path.startsWith('/repos/'));
    expect(gitCalls.length).toBeGreaterThan(10);
    for (const c of gitCalls) expect(c.headers.authorization).toBe(`Bearer ${token}`);
    expect(seen.join('\n')).not.toContain(token); // not in any response header or body the browser received
  });

  it('works through a token refresh in the middle of a deployment', async () => {
    const h = await makeHarness({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { grantedScope: '', expiring: true, expiresIn: 3600 } });
    await h.signIn();
    const { auth } = browser(h);
    await auth.getSession();
    h.clock.t += 3600 - 100; // token enters its refresh window right before the deployment
    const files = Array.from({ length: 10 }, (_, i) => bytesFile(`f${i}`, enc.encode(`c${i}`)));
    const r = await executeDeployment({ client: auth.createGitHubClient(), target, files, options: opts, concurrency: 4 });
    expect(r.status).toBe('success');
    expect(h.oauth.refreshCalls()).toBe(1);
  });

  it('a signed-out user gets the engine\'s AUTH error with a reconnect hint', async () => {
    const h = await makeHarness();
    const { auth } = browser(h);
    const r = await executeDeployment({ client: auth.createGitHubClient({ maxRetries: 0 }), target, files: [bytesFile('a', enc.encode('1'))], options: opts });
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('AUTH');
    expect(r.error?.hint).toMatch(/Reconnect/);
    expect(h.oauth.log.some((l) => l.host === 'api.github.com')).toBe(false);
  });

  it('recovers when the cached CSRF token went stale (new session) by refetching it once', async () => {
    const h = await makeHarness();
    await h.signIn();
    const { auth } = browser(h);
    await auth.getSession(); // caches CSRF of session A
    await h.signIn(); // session B replaces the cookie: A's CSRF is now invalid
    const sha = await auth.createGitHubClient().createBlob('o', 'r', enc.encode('hello'));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rate-limit headers survive the proxy, so the engine classifies RATE_LIMIT correctly', async () => {
    const h = await makeHarness();
    await h.signIn();
    const { auth } = browser(h);
    await auth.getSession();
    h.oauth.git.onRequest = () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 7200), 'content-type': 'application/json' } });
    const e = await auth.createGitHubClient({ maxRetries: 0 }).getBranch('o', 'r', 'main').catch((x) => x as EngineError);
    expect(e).toMatchObject({ code: 'RATE_LIMIT', recoverable: false });
  });

  it('sign-out ends GitHub access for the engine', async () => {
    const h = await makeHarness();
    await h.signIn();
    const { auth } = browser(h);
    await auth.getSession();
    expect(await auth.logout()).toEqual({ revoked: true });
    const e = await auth.createGitHubClient({ maxRetries: 0 }).getBranch('o', 'r', 'main').catch((x) => x as EngineError);
    expect(e).toMatchObject({ code: 'AUTH' });
  });
});

describe('serverless body limit (documented constraint, enforced and measured)', () => {
  it('the advertised max file size really fits; a larger file is refused with 413', async () => {
    const h = await makeHarness();
    await h.signIn();
    const { auth } = browser(h);
    await auth.getSession();
    const limit = maxProxiedFileBytes();
    expect(limit).toBeGreaterThan(3_000_000);
    expect(encodeBase64Bytes(new Uint8Array(limit)).length + 64).toBeLessThanOrEqual(MAX_PROXIED_BODY_BYTES);
    const client = auth.createGitHubClient({ maxRetries: 0 });
    expect(await client.createBlob('o', 'r', new Uint8Array(randomBytes(limit)))).toMatch(/^[0-9a-f]{40}$/);
    const e = await client.createBlob('o', 'r', new Uint8Array(randomBytes(limit + 400_000))).catch((x) => x as EngineError);
    expect(e).toMatchObject({ code: 'GITHUB_API', status: 413 });
  });
  it('zipLimits() makes ZIP inspection reject such files up front instead of failing mid-deploy', async () => {
    const auth = new AuthClient({ fetchImpl: (async () => new Response('{}')) as typeof fetch });
    const zip = new JSZip();
    zip.file('big.bin', new Uint8Array(randomBytes(maxProxiedFileBytes() + 1000)), { compression: 'STORE' } as never);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    await expect(inspectZip(bytes, { limits: auth.zipLimits() })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});

describe('Node adapter over a real HTTP server', () => {
  let h: Harness, server: Server, base: string;
  beforeAll(async () => {
    h = await makeHarness();
    server = createServer(toNodeHandler(h.app.handle, { maxBodyBytes: 1000 }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('full sign-in over real HTTP: redirects are real, two Set-Cookie headers stay separate, session works', async () => {
    const login = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    const stateCookie = login.headers.getSetCookie()[0].split(';')[0];
    const { callback } = h.oauth.authorize(login.headers.get('location')!);
    const cb = await fetch(`${base}${callback.pathname}${callback.search}`, { redirect: 'manual', headers: { cookie: stateCookie } });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('https://zipora.test/dashboard');
    const cookies = cb.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const sessionCookie = cookies.find((c) => c.startsWith('__Host-zipora_session='))!.split(';')[0];
    const s = await fetch(`${base}/api/auth/session`, { headers: { cookie: sessionCookie } });
    expect((await s.json()).user.login).toBe('octo-dev');
  });
  it('POST bodies over the limit get 413 before reaching the app', async () => {
    const r = await fetch(`${base}/api/github/repos/o/r/git/blobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(5000) });
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('unhandled failures become a generic 500 with no internals', async () => {
    const bad = createServer(toNodeHandler(async () => { throw new Error('secret internals gho_' + 'a'.repeat(30)); }));
    await new Promise<void>((r) => bad.listen(0, '127.0.0.1', r));
    const r = await fetch(`http://127.0.0.1:${(bad.address() as AddressInfo).port}/x`);
    await new Promise<void>((res) => bad.close(() => res()));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/secret|gho_/);
  });
});

describe('server configuration at runtime', () => {
  it('missing env → every endpoint answers 500 CONFIG_ERROR naming the variables (never values)', async () => {
    const keys = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'APP_URL'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.SESSION_SECRET = 'too-short-but-secret';
    const server = createServer(vercelHandler((app) => app.login));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/login`, { redirect: 'manual' });
      const text = await r.text();
      expect(r.status).toBe(500);
      expect(JSON.parse(text).error).toMatchObject({ code: 'CONFIG_ERROR' });
      expect(text).toContain('GITHUB_CLIENT_ID is required');
      expect(text).not.toContain('too-short-but-secret');
      await expect(getApp({})).rejects.toThrow(/Invalid server configuration/);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
  it('the Vercel entry files load and export handlers', async () => {
    const mods = await Promise.all([
      import('../../api/auth/login.js'), import('../../api/auth/callback.js'), import('../../api/auth/session.js'),
      import('../../api/auth/logout.js'), import('../../api/auth/diagnose.js'), import('../../api/github.js'),
    ]);
    for (const m of mods) expect(typeof m.default).toBe('function');
  });
});
