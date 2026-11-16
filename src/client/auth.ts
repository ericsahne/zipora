import { GitHubClient } from '../engine/github';
import type { ZipLimits } from '../engine/types';

export interface SessionUserInfo { id: number; login: string; avatarUrl: string; name: string | null }

export type SessionInfo =
  | { authenticated: false; reason?: 'invalid' | 'expired' | 'token_expired' | 'token_revoked' }
  | { authenticated: true; user: SessionUserInfo; csrfToken: string; sessionExpiresAt: number; tokenExpiresAt: number | null; scope: string };

export interface AuthClientOptions {
  /** Defaults to window.fetch. Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Origin prefix for API calls; '' (default) means same origin. */
  baseUrl?: string;
  /** Called whenever the server answers 401 to an API call (session ended or token revoked). */
  onUnauthorized?: () => void;
}

/**
 * Serverless request bodies are capped at ~4.5 MB. A file is sent as base64 inside JSON (4/3 size
 * plus a small envelope), so the largest file that fits through the proxy is about 3.3 MB.
 */
export const MAX_PROXIED_BODY_BYTES = 4_500_000;
export const maxProxiedFileBytes = (bodyLimit = MAX_PROXIED_BODY_BYTES): number => Math.floor(((bodyLimit - 512) * 3) / 4);

const unauthenticated = () =>
  new Response(JSON.stringify({ message: 'Not signed in' }), { status: 401, headers: { 'content-type': 'application/json' } });

/**
 * Browser-side entry to the auth backend. The GitHub access token never reaches this code: it lives in an
 * HttpOnly cookie, and GitHub calls go through /api/github, which attaches it on the server.
 */
export class AuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private csrf: string | undefined;
  /** Assignable after construction so the UI layer can subscribe. */
  onUnauthorized: (() => void) | undefined;

  constructor(opts: AuthClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.base = opts.baseUrl ?? '';
    this.onUnauthorized = opts.onUnauthorized;
  }

  /** Where to send the browser (full navigation) to start signing in. */
  loginUrl(returnTo?: string): string {
    return `${this.base}/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  }

  /** `verify` also asks GitHub whether the token is still valid (detects a revoked authorization). */
  async getSession(opts: { verify?: boolean } = {}): Promise<SessionInfo> {
    const res = await this.fetchImpl(`${this.base}/api/auth/session${opts.verify ? '?verify=1' : ''}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Session check failed (${res.status})`);
    const info = (await res.json()) as SessionInfo;
    this.csrf = info.authenticated ? info.csrfToken : undefined;
    return info;
  }

  async logout(): Promise<{ revoked: boolean }> {
    const res = await this.send('POST', '/api/auth/logout');
    this.csrf = undefined;
    if (!res.ok) throw new Error(`Sign-out failed (${res.status})`);
    return { revoked: Boolean(((await res.json()) as { revoked?: boolean }).revoked) };
  }

  private async csrfToken(): Promise<string | undefined> {
    if (!this.csrf) await this.getSession();
    return this.csrf;
  }

  private async send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.delete('authorization'); // never send a client-side credential; the server adds the real one
    const unsafe = !['GET', 'HEAD'].includes(method.toUpperCase());
    for (let attempt = 0; ; attempt++) {
      if (unsafe) {
        const token = await this.csrfToken();
        if (!token) return unauthenticated();
        headers.set('X-CSRF-Token', token);
      }
      const res = await this.fetchImpl(/^https?:/.test(path) ? path : `${this.base}${path}`, { ...init, method, headers, credentials: 'same-origin' });
      // A rotated secret or new session makes the cached token stale: refresh it and retry once.
      if (unsafe && attempt === 0 && res.status === 403) {
        const code = await res.clone().json().then((b: { error?: { code?: string } }) => b.error?.code, () => undefined);
        if (code === 'CSRF_INVALID') { this.csrf = undefined; continue; }
      }
      if (res.status === 401) this.onUnauthorized?.();
      return res;
    }
  }

  /** fetch() for GitHubClient: routes through the proxy and adds the CSRF header to state-changing calls. */
  readonly proxiedFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return this.send((init?.method ?? 'GET').toUpperCase(), url, init);
  };

  /** The unchanged Phase 1 GitHub client, pointed at the authenticated proxy. The token value is a placeholder. */
  createGitHubClient(options: { maxRetries?: number } = {}): GitHubClient {
    return new GitHubClient({ token: 'session', baseUrl: `${this.base}/api/github`, fetchImpl: this.proxiedFetch, ...options });
  }

  /** ZIP limits to pass to inspectZip so files that cannot fit through the proxy are rejected up front. */
  zipLimits(): Partial<ZipLimits> {
    return { maxFileBytes: maxProxiedFileBytes() };
  }
}
