import type { AuthConfig } from './config.js';
import { ApiError, errorResponse, json, logError } from './errors.js';
import type { Session, SessionService } from './session.js';

export type Handler = (req: Request) => Promise<Response>;
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireMethod(req: Request, allowed: string[]): void {
  if (!allowed.includes(req.method)) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${allowed.join(' or ')} for this endpoint.`, { headers: { allow: allowed.join(', ') } });
  }
}

/** Rejects requests that browsers mark cross-site, or whose Origin is not this app. */
export function assertSameSite(req: Request, cfg: AuthConfig): void {
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'CROSS_SITE_REQUEST', 'Cross-site requests are not allowed.');
  }
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== cfg.appOrigin) {
    throw new ApiError(403, 'BAD_ORIGIN', 'Request origin is not allowed.', { hint: `Requests must come from ${cfg.appOrigin}.` });
  }
}

export async function assertCsrf(svc: SessionService, req: Request, session: Session): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  if (!(await svc.csrfValid(session, req.headers.get('x-csrf-token')))) {
    throw new ApiError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token.', { hint: 'Reload the session (GET /api/auth/session) and send its csrfToken in the X-CSRF-Token header.' });
  }
}

/**
 * Authentication middleware. Order: same-site check → decrypt session → CSRF (state-changing methods)
 * → transparent token refresh → handler. A refreshed session cookie is attached to the response.
 */
export function withAuth(svc: SessionService, handler: (req: Request, ctx: { session: Session }) => Promise<Response>): Handler {
  return async (req) => {
    assertSameSite(req, svc.config);
    const read = await svc.read(req);
    if (read.kind === 'none') throw new ApiError(401, 'UNAUTHENTICATED', 'You are not signed in.', { hint: 'Sign in with GitHub.' });
    if (read.kind !== 'ok') {
      throw new ApiError(401, read.kind === 'expired' ? 'SESSION_EXPIRED' : 'SESSION_INVALID', read.kind === 'expired' ? 'Your session expired.' : 'Your session is invalid.', {
        hint: 'Sign in again.', setCookies: [svc.clearCookie()],
      });
    }
    await assertCsrf(svc, req, read.session);
    const { session, refreshed } = await svc.ensureFresh(read.session);
    const res = await handler(req, { session });
    if (!refreshed) return res;
    const out = new Response(res.body, res);
    out.headers.append('set-cookie', await svc.cookieFor(session));
    return out;
  };
}

/** Converts thrown errors into JSON responses; unknown errors become a generic 500 with a redacted log line. */
export function withErrors(cfg: AuthConfig, handler: Handler): Handler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      logError(e, [cfg.clientSecret, ...cfg.secrets]);
      return json({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } }, 500);
    }
  };
}
