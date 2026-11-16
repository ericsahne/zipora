import { createHash, randomBytes } from 'node:crypto';
import { createFakeGitHub, type FakeGitHub } from '../fakeGitHub.js';

export interface FakeOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Scope GitHub reports as granted (default "repo"). */
  grantedScope?: string;
  /** Issue GitHub-App style expiring tokens with refresh tokens. */
  expiring?: boolean;
  expiresIn?: number;
  /** With `expiring`: issue an expiring access token but no refresh token. */
  omitRefresh?: boolean;
  gitFiles?: Record<string, string>;
  repos?: Array<Record<string, unknown>>;
  orgs?: string[];
}

export interface LoggedRequest { host: string; path: string; method: string; headers: Record<string, string>; body?: any }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/** Stand-in for github.com/login/oauth, api.github.com/user and the Git Data API. It enforces what GitHub enforces:
 *  client secret, single-use codes, PKCE (S256), redirect_uri match, single-use rotating refresh tokens, Bearer auth. */
export function createFakeOAuth(o: FakeOAuthOptions) {
  const codes = new Map<string, { challenge: string }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const log: LoggedRequest[] = [];
  const git: FakeGitHub = createFakeGitHub(o.gitFiles ?? {});
  const state = { failNetwork: false, rejectUser: false, issued: [] as string[] };
  const repos: Array<Record<string, unknown>> = [...(o.repos ?? [])];
  const rand = (prefix: string) => `${prefix}_${randomBytes(20).toString('hex')}`;

  function issue(): Response {
    const access = rand('gho');
    accessTokens.add(access);
    state.issued.push(access);
    const body: Record<string, unknown> = { access_token: access, token_type: 'bearer', scope: o.grantedScope ?? 'repo' };
    if (o.expiring) {
      body.expires_in = o.expiresIn ?? 28800;
      if (!o.omitRefresh) {
        const refresh = rand('ghr');
        refreshTokens.add(refresh);
        Object.assign(body, { refresh_token: refresh, refresh_token_expires_in: 15811200 });
      }
    }
    return json(body);
  }

  const fake = {
    log, git, state, accessTokens, refreshTokens, repos,
    refreshCalls: () => log.filter((l) => l.body?.grant_type === 'refresh_token').length,
    /** What GitHub does after the user clicks "Authorize": validates the request and returns the callback URL. */
    authorize(location: string) {
      const u = new URL(location);
      if (u.origin !== 'https://github.com' || u.pathname !== '/login/oauth/authorize') throw new Error(`unexpected authorize URL ${location}`);
      const p = u.searchParams;
      if (p.get('client_id') !== o.clientId) throw new Error('client_id mismatch');
      if (p.get('redirect_uri') !== o.redirectUri) throw new Error('redirect_uri mismatch');
      if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) throw new Error('PKCE missing');
      const code = rand('code');
      codes.set(code, { challenge: p.get('code_challenge')! });
      const cb = new URL(o.redirectUri);
      cb.searchParams.set('code', code);
      cb.searchParams.set('state', p.get('state')!);
      return { callback: cb, params: p, code };
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (state.failNetwork) throw new TypeError('network down');
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      let body: any;
      const raw = init?.body;
      if (typeof raw === 'string') body = JSON.parse(raw);
      else if (raw) body = JSON.parse(new TextDecoder().decode(raw as Uint8Array)); // the proxy forwards bodies as bytes
      log.push({ host: url.host, path: url.pathname, method, headers, body });

      if (url.host === 'github.com' && url.pathname === '/login/oauth/access_token') {
        if (body.client_id !== o.clientId || body.client_secret !== o.clientSecret) return json({ error: 'incorrect_client_credentials' });
        if (body.grant_type === 'refresh_token') {
          if (!refreshTokens.delete(body.refresh_token)) return json({ error: 'bad_refresh_token' });
          return issue();
        }
        const c = codes.get(body.code);
        if (!c) return json({ error: 'bad_verification_code' });
        codes.delete(body.code); // single use
        if (body.redirect_uri !== o.redirectUri) return json({ error: 'redirect_uri_mismatch' });
        if (createHash('sha256').update(body.code_verifier ?? '').digest('base64url') !== c.challenge) return json({ error: 'bad_verification_code' });
        return issue();
      }
      if (url.host !== 'api.github.com') return json({ message: 'unexpected host' }, 500);

      if (url.pathname.startsWith('/applications/') && method === 'DELETE') {
        const expected = `Basic ${Buffer.from(`${o.clientId}:${o.clientSecret}`).toString('base64')}`;
        if (headers.authorization !== expected) return json({ message: 'Bad credentials' }, 401);
        return accessTokens.delete(body?.access_token) ? new Response(null, { status: 204 }) : json({ message: 'Not Found' }, 404);
      }
      const token = headers.authorization?.replace(/^Bearer /, '');
      if (!token || !accessTokens.has(token) || state.rejectUser && url.pathname === '/user') return json({ message: 'Bad credentials' }, 401);
      if (url.pathname === '/user') return json({ id: 4242, login: 'octo-dev', avatar_url: 'https://avatars.example/octo.png', name: 'Octo Dev' });
      if (url.pathname === '/user/repos' && method === 'GET') return json(repos);
      if (url.pathname === '/user/repos' && method === 'POST') {
        if (repos.some((r) => r.name === body.name)) return json({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }, 422);
        const created = { id: 1000 + repos.length, name: body.name, full_name: `octo-dev/${body.name}`, owner: { login: 'octo-dev' }, private: body.private === true, description: body.description ?? null, default_branch: 'main', html_url: `https://github.com/octo-dev/${body.name}`, permissions: { admin: true, push: true, pull: true }, archived: false, fork: false, pushed_at: '2026-11-01T00:00:00Z' };
        repos.unshift(created);
        return json(created, 201);
      }
      if (url.pathname === '/user/orgs') return json((o.orgs ?? []).map((login) => ({ login })));
      if (/^\/repos\/[^/]+\/[^/]+\/branches$/.test(url.pathname)) return git.onRequest?.(method, url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''), body) ?? json(git.branches().map((name) => ({ name, commit: { sha: 'x' }, protected: name === 'protected-branch' })));
      if (url.pathname.startsWith('/repos/')) return git.fetch(input, init);
      return json({ message: 'Not Found' }, 404);
    }) as typeof fetch,
  };
  return fake;
}
export type FakeOAuth = ReturnType<typeof createFakeOAuth>;
