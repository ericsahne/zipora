import type { AuthConfig } from './config.js';
import { ApiError } from './errors.js';

export interface Deps { fetch: typeof fetch; now: () => number }

export interface TokenSet {
  access: string;
  scope: string;
  expiresAt?: number;
  refresh?: string;
  refreshExpiresAt?: number;
}

export interface SessionUser { id: number; login: string; avatarUrl: string; name: string | null }

const OAUTH_TIMEOUT_MS = 10_000;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'ZIPORA' };

export function authorizeUrl(cfg: AuthConfig, state: string, codeChallenge: string): string {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  if (cfg.scope) u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

function mapOAuthError(code: string): ApiError {
  const safe = /^[a-z_]{1,64}$/.test(code) ? code : 'unknown';
  switch (safe) {
    case 'bad_verification_code': return new ApiError(400, 'INVALID_CODE', 'The GitHub authorization code is invalid or expired.', { hint: 'Start the sign-in again.' });
    case 'bad_refresh_token': return new ApiError(401, 'SESSION_EXPIRED', 'GitHub authorization expired.', { hint: 'Sign in again.' });
    case 'access_denied': return new ApiError(403, 'ACCESS_DENIED', 'Authorization was denied on GitHub.', { hint: 'Approve the request to continue.' });
    case 'redirect_uri_mismatch':
    case 'incorrect_client_credentials':
    case 'unauthorized_client':
      return new ApiError(500, 'OAUTH_MISCONFIGURED', 'The GitHub OAuth app is misconfigured.', { hint: 'Check GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and that the callback URL is APP_URL + /api/auth/callback.' });
    default: return new ApiError(502, 'GITHUB_OAUTH_ERROR', `GitHub OAuth error: ${safe}.`, { hint: 'Try again shortly.' });
  }
}

function parseTokenResponse(body: unknown, now: number): TokenSet {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.error === 'string') throw mapOAuthError(b.error);
  if (typeof b.access_token !== 'string' || !b.access_token) {
    throw new ApiError(502, 'GITHUB_OAUTH_ERROR', 'GitHub returned an unexpected token response.');
  }
  const secs = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? now + Math.floor(v) : undefined);
  return {
    access: b.access_token,
    scope: typeof b.scope === 'string' ? b.scope : '',
    expiresAt: secs(b.expires_in),
    refresh: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : undefined,
    refreshExpiresAt: secs(b.refresh_token_expires_in),
  };
}

async function tokenRequest(cfg: AuthConfig, deps: Deps, params: Record<string, string>): Promise<TokenSet> {
  let res: Response;
  try {
    res = await deps.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: JSON_HEADERS, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
    });
  } catch {
    throw new ApiError(502, 'GITHUB_UNREACHABLE', 'Could not reach GitHub.', { hint: 'Try again in a moment.' });
  }
  if (!res.ok) throw new ApiError(502, 'GITHUB_OAUTH_ERROR', `GitHub token endpoint returned ${res.status}.`);
  let body: unknown;
  try { body = await res.json(); } catch { throw new ApiError(502, 'GITHUB_OAUTH_ERROR', 'GitHub returned an unreadable token response.'); }
  return parseTokenResponse(body, deps.now());
}

export const exchangeCode = (cfg: AuthConfig, deps: Deps, code: string, codeVerifier: string): Promise<TokenSet> =>
  tokenRequest(cfg, deps, { code, redirect_uri: cfg.redirectUri, code_verifier: codeVerifier });

export const refreshAccessToken = (cfg: AuthConfig, deps: Deps, refreshToken: string): Promise<TokenSet> =>
  tokenRequest(cfg, deps, { grant_type: 'refresh_token', refresh_token: refreshToken });

export async function fetchGitHubUser(f: typeof fetch, accessToken: string): Promise<SessionUser> {
  let res: Response;
  try {
    res = await f('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ZIPORA', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, 'GITHUB_UNREACHABLE', 'Could not reach GitHub.', { hint: 'Try again in a moment.' });
  }
  if (res.status === 401) throw new ApiError(401, 'TOKEN_INVALID', 'GitHub rejected the access token.', { hint: 'Sign in again.' });
  if (res.status === 403) throw new ApiError(403, 'GITHUB_FORBIDDEN', 'GitHub refused to return the profile.', { hint: 'Check rate limits and app permissions.' });
  if (!res.ok) throw new ApiError(502, 'GITHUB_API_ERROR', `GitHub returned ${res.status} for the user profile.`);
  const u = (await res.json()) as Record<string, unknown>;
  if (typeof u.id !== 'number' || typeof u.login !== 'string') throw new ApiError(502, 'GITHUB_API_ERROR', 'GitHub returned an unexpected profile.');
  return { id: u.id, login: u.login, avatarUrl: typeof u.avatar_url === 'string' ? u.avatar_url : '', name: typeof u.name === 'string' ? u.name : null };
}

/** Best effort: returns whether GitHub confirmed the token was revoked. Never throws. */
export async function revokeToken(cfg: AuthConfig, f: typeof fetch, accessToken: string): Promise<boolean> {
  try {
    const res = await f(`https://api.github.com/applications/${encodeURIComponent(cfg.clientId)}/token`, {
      method: 'DELETE', signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'ZIPORA',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** True when every requested scope is granted ("repo" covers "public_repo"). Empty request = nothing to check. */
export function hasRequiredScopes(requested: string, granted: string): boolean {
  const want = requested.split(/[ ,]+/).filter(Boolean);
  const have = new Set(granted.split(/[ ,]+/).filter(Boolean));
  return want.every((s) => have.has(s) || (s === 'public_repo' && have.has('repo')));
}
