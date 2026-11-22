import type { AuthConfig } from './config.js';
import { parseCookies, serializeCookie, clearCookie } from './cookies.js';
import { csrfMatches, csrfToken, deriveKeys, open, randomToken, seal, sha256b64u, type Keys } from './crypto.js';
import { ApiError } from './errors.js';
import { refreshAccessToken, type Deps, type SessionUser, type TokenSet } from './githubOAuth.js';

export interface Session {
  v: 1;
  sid: string;
  iat: number;
  exp: number;
  user: SessionUser;
  token: TokenSet;
}

export type ReadResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'ok'; session: Session };

/** Refresh a little early so a long deployment does not start with a token about to expire. */
export const REFRESH_SKEW_SECONDS = 300;
/**
 * Requests already in flight when a refresh completes still carry the OLD cookie, whose single-use refresh
 * token is now spent. For this long they reuse the new token instead of failing.
 */
export const REFRESH_GRACE_SECONDS = 60;

export class SessionService {
  private readonly inflight = new Map<string, Promise<TokenSet>>();
  /** Result of a just-finished refresh, keyed by the (now spent) refresh token's hash. */
  private readonly recent = new Map<string, { token: TokenSet; until: number }>();
  private constructor(readonly config: AuthConfig, readonly keys: Keys, private readonly deps: Deps) {}

  static async create(config: AuthConfig, deps: Deps): Promise<SessionService> {
    return new SessionService(config, await deriveKeys(config.secrets), deps);
  }

  newSession(user: SessionUser, token: TokenSet): Session {
    const now = this.deps.now();
    return { v: 1, sid: randomToken(16), iat: now, exp: now + this.config.sessionTtlSeconds, user, token };
  }

  /** Set-Cookie header value carrying the encrypted session. */
  async cookieFor(session: Session): Promise<string> {
    const maxAge = Math.max(0, session.exp - this.deps.now());
    return serializeCookie(this.config.cookieNames.session, await seal(this.keys, 'session', session), { secure: this.config.secure, maxAge });
  }

  clearCookie(): string {
    return clearCookie(this.config.cookieNames.session, this.config.secure);
  }

  async read(request: Request): Promise<ReadResult> {
    const raw = parseCookies(request.headers.get('cookie')).get(this.config.cookieNames.session);
    if (!raw) return { kind: 'none' };
    const s = await open<Session>(this.keys, 'session', raw);
    if (!s || s.v !== 1 || typeof s.sid !== 'string' || typeof s.exp !== 'number' || typeof s.token?.access !== 'string' || typeof s.user?.login !== 'string') {
      return { kind: 'invalid' };
    }
    return this.deps.now() >= s.exp ? { kind: 'expired' } : { kind: 'ok', session: s };
  }

  csrfToken(session: Session): Promise<string> {
    return csrfToken(this.keys, session.sid);
  }

  csrfValid(session: Session, supplied: string | null): Promise<boolean> {
    return supplied ? csrfMatches(this.keys, session.sid, supplied) : Promise.resolve(false);
  }

  /**
   * Refreshes an expiring GitHub App user token. Refresh tokens are single-use, so concurrent
   * requests in this process share one refresh. (Across separate server instances a race is still
   * possible; the SPA avoids it by calling /api/auth/session before long operations.)
   */
  async ensureFresh(session: Session): Promise<{ session: Session; refreshed: boolean }> {
    const t = session.token;
    const now = this.deps.now();
    if (t.expiresAt === undefined || now < t.expiresAt - REFRESH_SKEW_SECONDS) return { session, refreshed: false };
    const expired = () => new ApiError(401, 'SESSION_EXPIRED', 'GitHub authorization expired.', { hint: 'Sign in again.', setCookies: [this.clearCookie()] });
    if (!t.refresh || (t.refreshExpiresAt !== undefined && now >= t.refreshExpiresAt)) {
      if (now < t.expiresAt) return { session, refreshed: false }; // still valid, just cannot be renewed
      throw expired();
    }
    const key = sha256b64u(t.refresh);
    for (const [k, v] of this.recent) if (now >= v.until) this.recent.delete(k);
    const graced = this.recent.get(key);
    if (graced) return { session: { ...session, token: graced.token }, refreshed: true };
    let p = this.inflight.get(key);
    if (!p) {
      p = refreshAccessToken(this.config, this.deps, t.refresh)
        .then((tok) => { this.recent.set(key, { token: { ...tok, scope: tok.scope || t.scope }, until: this.deps.now() + REFRESH_GRACE_SECONDS }); return tok; })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    let fresh: TokenSet;
    try { fresh = await p; } catch (e) {
      if (e instanceof ApiError && (e.code === 'SESSION_EXPIRED' || e.code === 'INVALID_CODE')) throw expired();
      throw e;
    }
    return { session: { ...session, token: { ...fresh, scope: fresh.scope || t.scope } }, refreshed: true };
  }
}
