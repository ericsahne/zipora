import type { AuthConfig } from './config.js';
import { clearCookie } from './cookies.js';
import { ApiError, logInfo, respond } from './errors.js';
import type { Deps } from './githubOAuth.js';
import type { Session } from './session.js';

const PREFIX = '/api/github';
const N = '[A-Za-z0-9._-]+';
const REF = '[A-Za-z0-9._~%+@=/-]+';
const SHA = '[A-Za-z0-9]{1,64}';

/** The only GitHub endpoints the deployment engine and repository selector need. Everything else is refused. */
const RULES: Array<{ method: string; re: RegExp }> = [
  { method: 'GET', re: /^\/user$/ },
  { method: 'GET', re: /^\/user\/repos$/ },
  { method: 'GET', re: /^\/user\/orgs$/ },
  { method: 'POST', re: /^\/user\/repos$/ },
  { method: 'POST', re: new RegExp(`^/orgs/${N}/repos$`) },
  { method: 'GET', re: new RegExp(`^/repos/${N}/${N}$`) },
  { method: 'GET', re: new RegExp(`^/repos/${N}/${N}/branches$`) },
  { method: 'GET', re: new RegExp(`^/repos/${N}/${N}/git/ref/heads/${REF}$`) },
  { method: 'GET', re: new RegExp(`^/repos/${N}/${N}/git/(commits|trees)/${SHA}$`) },
  { method: 'POST', re: new RegExp(`^/repos/${N}/${N}/git/(blobs|trees|commits|refs)$`) },
  { method: 'PATCH', re: new RegExp(`^/repos/${N}/${N}/git/refs/heads/${REF}$`) },
];

const QUERY_KEYS = new Set(['recursive', 'per_page', 'page', 'sort', 'direction', 'visibility', 'affiliation', 'type']);
const FORWARD_RESPONSE_HEADERS = [
  'content-type', 'etag', 'retry-after', 'x-github-request-id', 'x-oauth-scopes', 'x-accepted-oauth-scopes', 'x-accepted-github-permissions',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used', 'x-ratelimit-resource',
];
const UPSTREAM_TIMEOUT_MS = 55_000;

function upstreamTarget(url: URL, method: string): string {
  if (!url.pathname.startsWith(PREFIX + '/')) throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint.');
  const rest = url.pathname.slice(PREFIX.length);
  let decoded: string;
  try { decoded = decodeURIComponent(rest); } catch { throw new ApiError(400, 'BAD_PATH', 'Malformed path.'); }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some((s) => s === '..' || s === '.') || decoded.includes('//')) {
    throw new ApiError(400, 'BAD_PATH', 'Path contains forbidden segments.');
  }
  // A path can allow several methods (e.g. GET and POST /user/repos): match on path AND method.
  const forPath = RULES.filter((r) => r.re.test(rest));
  if (forPath.length === 0) throw new ApiError(403, 'ENDPOINT_NOT_ALLOWED', 'This GitHub endpoint is not available through ZIPORA.', { hint: 'Only repository, branch and Git Data API calls needed for deployment are allowed.' });
  if (!forPath.some((r) => r.method === method)) {
    const allowed = forPath.map((r) => r.method).join(', ');
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${allowed} for this endpoint.`, { headers: { allow: allowed } });
  }
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!QUERY_KEYS.has(k) || !/^[A-Za-z0-9_,.-]{1,100}$/.test(v)) throw new ApiError(400, 'BAD_QUERY', `Query parameter "${k}" is not allowed.`);
    q.append(k, v);
  }
  const qs = q.toString();
  return `https://api.github.com${rest}${qs ? `?${qs}` : ''}`;
}

/**
 * Authenticated pass-through to api.github.com. The browser never sees the access token: it is
 * attached here from the encrypted session, and any Authorization/Cookie header from the client is dropped.
 */
export function createProxy(cfg: AuthConfig, deps: Deps) {
  return async (req: Request, ctx: { session: Session }): Promise<Response> => {
    const url = new URL(req.url);
    const target = upstreamTarget(url, req.method);

    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method === 'POST' || req.method === 'PATCH') {
      const ct = req.headers.get('content-type') ?? '';
      if (!ct.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.');
      body = new Uint8Array(await req.arrayBuffer());
      if (body.byteLength > cfg.proxyMaxBodyBytes) {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Request body is ${body.byteLength} bytes; the limit is ${cfg.proxyMaxBodyBytes}.`, {
          hint: 'Serverless functions cap request bodies (about 4.5 MB). Files above roughly 3.3 MB cannot be uploaded through the proxy.',
        });
      }
    }

    const headers = new Headers({
      Authorization: `Bearer ${ctx.session.token.access}`,
      'User-Agent': 'ZIPORA',
      Accept: req.headers.get('accept') ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (body) headers.set('Content-Type', 'application/json');

    let upstream: Response;
    try {
      upstream = await deps.fetch(target, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ApiError(timeout ? 504 : 502, timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE', timeout ? 'GitHub did not respond in time.' : 'Could not reach GitHub.', { hint: 'Retry shortly.' });
    }

    const out: Record<string, string> = {};
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(name);
      if (v !== null) out[name] = v;
    }
    const link = upstream.headers.get('link');
    if (link) out.link = link.split('https://api.github.com').join(`${cfg.appOrigin}${PREFIX}`);

    // A revoked or expired token: also drop the cookie so the SPA sees a signed-out state.
    const cookies = upstream.status === 401 ? [clearSession(cfg)] : [];
    const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
    const payload = noBody ? null : await upstream.arrayBuffer();

    // Safe diagnostics for Vercel logs: status, GitHub's message, user, scopes and repository count. Never tokens or bodies.
    const pathOnly = new URL(target).pathname;
    if (payload && (upstream.status >= 400 || (pathOnly === '/user/repos' && req.method === 'GET'))) {
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder().decode(payload)); } catch { /* not JSON */ }
      const msg = (parsed as { message?: unknown } | undefined)?.message;
      logInfo('github', {
        req: `${req.method} ${pathOnly}`, status: upstream.status, user: ctx.session.user.login, scopes: upstream.headers.get('x-oauth-scopes') ?? 'no-header',
        ...(Array.isArray(parsed) ? { repos: parsed.length } : {}), ...(upstream.status >= 400 && typeof msg === 'string' ? { message: msg } : {}),
      }, [cfg.clientSecret, ...cfg.secrets]);
    }
    return respond(payload, upstream.status, out, cookies);
  };
}

const clearSession = (cfg: AuthConfig): string => clearCookie(cfg.cookieNames.session, cfg.secure);
