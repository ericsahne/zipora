import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../../src/server/config';
import { clearCookie, parseCookies, serializeCookie } from '../../src/server/cookies';
import { csrfMatches, csrfToken, deriveKeys, open, seal } from '../../src/server/crypto';
import { logError, redact } from '../../src/server/errors';
import { BASE_ENV } from './harness';

const problems = (env: Record<string, string | undefined>) => { try { loadConfig(env); return []; } catch (e) { return (e as ConfigError).problems; } };

describe('configuration', () => {
  it('loads a valid https config with secure defaults', () => {
    const c = loadConfig(BASE_ENV);
    expect(c).toMatchObject({ appOrigin: 'https://zipora.test', secure: true, redirectUri: 'https://zipora.test/api/auth/callback', scope: 'repo', sessionTtlSeconds: 604800 });
    expect(c.cookieNames.session).toBe('__Host-zipora_session');
  });
  it('allows http only for localhost, and drops the __Host- prefix there', () => {
    const c = loadConfig({ ...BASE_ENV, APP_URL: 'http://localhost:3000' });
    expect(c.secure).toBe(false);
    expect(c.cookieNames.session).toBe('zipora_session');
    expect(problems({ ...BASE_ENV, APP_URL: 'http://example.com' })[0]).toMatch(/https/);
  });
  it('reports every missing variable by name', () => {
    expect(problems({})).toEqual(expect.arrayContaining(['GITHUB_CLIENT_ID is required', 'GITHUB_CLIENT_SECRET is required', 'SESSION_SECRET is required', 'APP_URL is required']));
  });
  it('never puts secret values into error messages', () => {
    const e = (() => { try { loadConfig({ ...BASE_ENV, SESSION_SECRET: 'short-secret-value' }); } catch (err) { return err as ConfigError; } })()!;
    expect(e.message).toMatch(/at least 32/);
    expect(e.message).not.toContain('short-secret-value');
  });
  it.each([['https://x.test/path'], ['https://x.test/?a=1'], ['not a url'], ['https://user:pw@x.test']])('rejects APP_URL %s', (url) => {
    expect(problems({ ...BASE_ENV, APP_URL: url }).length).toBeGreaterThan(0);
  });
  it('normalises scopes, supports "none" for GitHub Apps, and rejects junk', () => {
    expect(loadConfig({ ...BASE_ENV, GITHUB_OAUTH_SCOPE: 'public_repo, read:user' }).scope).toBe('public_repo read:user');
    expect(loadConfig({ ...BASE_ENV, GITHUB_OAUTH_SCOPE: 'none' }).scope).toBe('');
    expect(problems({ ...BASE_ENV, GITHUB_OAUTH_SCOPE: 'repo&evil=1' }).length).toBe(1);
  });
  it('bounds numeric settings and supports key rotation', () => {
    expect(problems({ ...BASE_ENV, SESSION_TTL_SECONDS: '10' }).length).toBe(1);
    expect(problems({ ...BASE_ENV, SESSION_TTL_SECONDS: 'abc' }).length).toBe(1);
    expect(loadConfig({ ...BASE_ENV, SESSION_TTL_SECONDS: '3600', SESSION_SECRET_PREVIOUS: 'p'.repeat(40) })).toMatchObject({ sessionTtlSeconds: 3600, secrets: [BASE_ENV.SESSION_SECRET, 'p'.repeat(40)] });
  });
});

describe('sealed cookies (AES-256-GCM)', () => {
  const secretA = 'a'.repeat(40), secretB = 'b'.repeat(40);
  const payload = { token: 'gho_supersecrettokenvalue1234567890', n: 1 };

  it('round-trips and never exposes plaintext', async () => {
    const keys = await deriveKeys([secretA]);
    const sealed = await seal(keys, 'session', payload);
    expect(sealed).not.toContain('gho_');
    expect(Buffer.from(sealed.split('.')[2], 'base64url').toString('latin1')).not.toContain('supersecret');
    expect(await open(keys, 'session', sealed)).toEqual(payload);
  });
  it('uses a fresh IV every time', async () => {
    const keys = await deriveKeys([secretA]);
    expect(await seal(keys, 'session', payload)).not.toBe(await seal(keys, 'session', payload));
  });
  it('rejects tampering, truncation, garbage, wrong purpose and wrong key (returns null, never throws)', async () => {
    const keys = await deriveKeys([secretA]);
    const sealed = await seal(keys, 'session', payload);
    const [v, iv, ct] = sealed.split('.');
    const flipped = `${v}.${iv}.${ct.slice(0, -2)}${ct.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(await open(keys, 'session', flipped)).toBeNull();
    expect(await open(keys, 'session', sealed.slice(0, -6))).toBeNull();
    for (const junk of ['', 'x', 'v1..', 'v2.a.b', 'v1.a.b.c', '....']) expect(await open(keys, 'session', junk)).toBeNull();
    expect(await open(keys, 'oauth', sealed)).toBeNull(); // purpose is authenticated
    expect(await open(await deriveKeys([secretB]), 'session', sealed)).toBeNull();
  });
  it('supports rotation: old sessions open with [new, old]; new ones do not open with old only', async () => {
    const oldKeys = await deriveKeys([secretA]);
    const rotated = await deriveKeys([secretB, secretA]);
    expect(await open(rotated, 'session', await seal(oldKeys, 'session', payload))).toEqual(payload);
    expect(await open(oldKeys, 'session', await seal(rotated, 'session', payload))).toBeNull();
  });
  it('CSRF tokens are per-session, deterministic, and rotation-tolerant', async () => {
    const keys = await deriveKeys([secretA]);
    const t = await csrfToken(keys, 'sid-1');
    expect(t).toBe(await csrfToken(keys, 'sid-1'));
    expect(t).not.toBe(await csrfToken(keys, 'sid-2'));
    expect(await csrfMatches(keys, 'sid-1', t)).toBe(true);
    expect(await csrfMatches(keys, 'sid-2', t)).toBe(false);
    expect(await csrfMatches(keys, 'sid-1', '')).toBe(false);
    expect(await csrfMatches(await deriveKeys([secretB, secretA]), 'sid-1', t)).toBe(true);
  });
});

describe('cookie helpers', () => {
  it('sets HttpOnly, Path=/, SameSite=Lax, Secure and Max-Age', () => {
    expect(serializeCookie('__Host-s', 'abc', { secure: true, maxAge: 60 })).toBe('__Host-s=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
    expect(serializeCookie('s', 'abc', { secure: false })).not.toContain('Secure');
    expect(clearCookie('s', true)).toContain('Max-Age=0');
  });
  it('refuses unsafe names/values (header injection)', () => {
    expect(() => serializeCookie('a b', 'x', { secure: true })).toThrow();
    expect(() => serializeCookie('a', 'x; Domain=evil.com', { secure: true })).toThrow();
    expect(() => serializeCookie('a', 'x\r\nSet-Cookie: y=1', { secure: true })).toThrow();
  });
  it('parses cookie headers; the first occurrence wins', () => {
    const m = parseCookies('a=1; b=2; a=3; junk');
    expect(m.get('a')).toBe('1');
    expect(m.get('b')).toBe('2');
    expect(parseCookies(null).size).toBe(0);
  });
});

describe('log redaction', () => {
  it('removes GitHub token shapes and supplied secrets', () => {
    const t = 'gho_' + 'a1B2'.repeat(9);
    expect(redact(`oops ${t} and github_pat_${'x'.repeat(30)} and mysecretvalue`, ['mysecretvalue'])).toBe('oops [redacted-token] and [redacted-token] and [redacted]');
  });
  it('logError never prints a token', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError(new Error(`request failed for gho_${'z9'.repeat(15)}`), ['csecret-value-456']);
    const out = String(spy.mock.calls[0][0]);
    spy.mockRestore();
    expect(out).toContain('[redacted-token]');
    expect(out).not.toMatch(/gho_[a-z0-9]{10}/);
  });
});
