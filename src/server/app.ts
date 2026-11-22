import type { AuthConfig } from './config.js';
import { clearCookie, parseCookies, serializeCookie } from './cookies.js';
import { open, randomToken, seal, sha256b64u, timingSafeEqualStr } from './crypto.js';
import { runDiagnostics, tokenKindOf } from './diagnose.js';
import { ApiError, json, logInfo, redirect } from './errors.js';
import { authorizeUrl, exchangeCode, fetchGitHubUser, hasRequiredScopes, revokeToken, type Deps } from './githubOAuth.js';
import { assertCsrf, assertSameSite, requireMethod, withAuth, withErrors, type Handler } from './middleware.js';
import { createProxy } from './proxy.js';
import { SessionService } from './session.js';

export const OAUTH_COOKIE_TTL_SECONDS = 600;
export const DEFAULT_RETURN_TO = '/dashboard';

interface OAuthCookie { state: string; verifier: string; returnTo: string; exp: number }

/** Only same-origin relative paths survive; anything else (absolute URLs, //host, backslashes) becomes the default. */
export function sanitizeReturnTo(raw: string | null, origin: string): string {
  if (!raw || raw.length > 200 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_RETURN_TO;
  try {
    // Also reject control characters and backslashes hidden behind percent-encoding.
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(raw))) return DEFAULT_RETURN_TO;
    const u = new URL(raw, origin);
    if (u.origin !== origin) return DEFAULT_RETURN_TO;
    if (u.pathname.startsWith('/api/')) return DEFAULT_RETURN_TO;
    return u.pathname + u.search;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export interface App {
  login: Handler;
  callback: Handler;
  session: Handler;
  logout: Handler;
  github: Handler;
  /** Authenticated GitHub-access diagnostics (safe: no tokens in the output). */
  diagnose: Handler;
  /** Dispatches by pathname; used by tests and by any non-Vercel host. */
  handle: Handler;
  sessions: SessionService;
}

export async function createApp(config: AuthConfig, overrides: Partial<Deps> = {}): Promise<App> {
  const deps: Deps = { fetch: overrides.fetch ?? ((...a) => fetch(...a)), now: overrides.now ?? (() => Math.floor(Date.now() / 1000)) };
  const svc = await SessionService.create(config, deps);
  const secure = config.secure;

  const login: Handler = async (req) => {
    requireMethod(req, ['GET']);
    const returnTo = sanitizeReturnTo(new URL(req.url).searchParams.get('returnTo'), config.appOrigin);
    const state = randomToken();
    const verifier = randomToken();
    const payload: OAuthCookie = { state, verifier, returnTo, exp: deps.now() + OAUTH_COOKIE_TTL_SECONDS };
    const cookie = serializeCookie(config.cookieNames.oauth, await seal(svc.keys, 'oauth', payload), { secure, maxAge: OAUTH_COOKIE_TTL_SECONDS });
    return redirect(authorizeUrl(config, state, sha256b64u(verifier)), [cookie]);
  };

  const callback: Handler = async (req) => {
    requireMethod(req, ['GET']);
    const url = new URL(req.url);
    const clearOAuth = clearCookie(config.cookieNames.oauth, secure); // the state is single-use: always consumed
    const fail = (code: string) => redirect(`${config.appOrigin}/?auth_error=${encodeURIComponent(code)}`, [clearOAuth]);

    const raw = parseCookies(req.headers.get('cookie')).get(config.cookieNames.oauth);
    const saved = raw ? await open<OAuthCookie>(svc.keys, 'oauth', raw) : null;
    if (!saved || typeof saved.state !== 'string' || typeof saved.verifier !== 'string' || typeof saved.exp !== 'number' || saved.exp <= deps.now()) return fail('OAUTH_STATE_INVALID');
    const state = url.searchParams.get('state');
    if (!state || !timingSafeEqualStr(state, saved.state)) return fail('OAUTH_STATE_INVALID');
    const err = url.searchParams.get('error');
    if (err) return fail(err === 'access_denied' ? 'ACCESS_DENIED' : 'OAUTH_ERROR');
    const code = url.searchParams.get('code');
    if (!code || code.length > 256) return fail('OAUTH_CODE_MISSING');

    try {
      const token = await exchangeCode(config, deps, code, saved.verifier);
      if (!hasRequiredScopes(config.scope, token.scope)) {
        await revokeToken(config, deps.fetch, token.access); // we will not use it; do not leave it live
        throw new ApiError(403, 'INSUFFICIENT_SCOPE', 'GitHub did not grant the required permissions.', { hint: `ZIPORA needs: ${config.scope}.` });
      }
      const user = await fetchGitHubUser(deps.fetch, token.access);
      logInfo('sign-in', { login: user.login, tokenKind: tokenKindOf(token.access), requestedScope: config.scope || '(none)', grantedScope: token.scope || '(none reported)' }, [config.clientSecret, ...config.secrets]);
      const session = svc.newSession(user, token);
      return redirect(config.appOrigin + sanitizeReturnTo(saved.returnTo, config.appOrigin), [clearOAuth, await svc.cookieFor(session)]);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code);
      console.error('[zipora] callback failed unexpectedly');
      return fail('INTERNAL');
    }
  };

  const session: Handler = async (req) => {
    requireMethod(req, ['GET']);
    assertSameSite(req, config);
    const read = await svc.read(req);
    if (read.kind === 'none') return json({ authenticated: false });
    if (read.kind !== 'ok') return json({ authenticated: false, reason: read.kind }, 200, [svc.clearCookie()]);
    let current = read.session;
    let refreshed = false;
    try {
      ({ session: current, refreshed } = await svc.ensureFresh(current));
      if (new URL(req.url).searchParams.get('verify') === '1') await fetchGitHubUser(deps.fetch, current.token.access);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') return json({ authenticated: false, reason: 'token_expired' }, 200, [svc.clearCookie()]);
      if (e instanceof ApiError && e.code === 'TOKEN_INVALID') return json({ authenticated: false, reason: 'token_revoked' }, 200, [svc.clearCookie()]);
      throw e;
    }
    return json({
      authenticated: true,
      user: current.user,
      csrfToken: await svc.csrfToken(current),
      sessionExpiresAt: current.exp,
      tokenExpiresAt: current.token.expiresAt ?? null,
      scope: current.token.scope,
    }, 200, refreshed ? [await svc.cookieFor(current)] : []);
  };

  const logout: Handler = async (req) => {
    requireMethod(req, ['POST']);
    assertSameSite(req, config);
    const read = await svc.read(req);
    let revoked = false;
    if (read.kind === 'ok') {
      await assertCsrf(svc, req, read.session);
      revoked = await revokeToken(config, deps.fetch, read.session.token.access);
    }
    return json({ ok: true, revoked }, 200, [svc.clearCookie(), clearCookie(config.cookieNames.oauth, secure)]);
  };

  const proxy = createProxy(config, deps);
  const github = withAuth(svc, proxy);
  const diagnose = withAuth(svc, async (req, { session }) => json(await runDiagnostics(deps, session, [config.clientSecret, ...config.secrets], new URL(req.url).searchParams.get('repo') ?? undefined)));

  const routes: Record<string, Handler> = {
    '/api/auth/login': login, '/api/auth/callback': callback, '/api/auth/session': session, '/api/auth/logout': logout, '/api/auth/diagnose': diagnose,
  };
  const handle: Handler = async (req) => {
    const path = new URL(req.url).pathname;
    const h = routes[path] ?? (path.startsWith('/api/github/') ? github : undefined);
    if (!h) throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint.');
    return h(req);
  };

  const wrap = (h: Handler) => withErrors(config, h);
  return { login: wrap(login), callback: wrap(callback), session: wrap(session), logout: wrap(logout), github: wrap(github), diagnose: wrap(diagnose), handle: wrap(handle), sessions: svc };
}
