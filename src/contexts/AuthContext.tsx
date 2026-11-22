import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthClient, type SessionUserInfo } from '../client/auth';
import type { GitHubClient } from '../engine';
import { nav } from '../services/navigation';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'expired' | 'error';

interface AuthState {
  status: AuthStatus;
  user?: SessionUserInfo;
  scope?: string;
  sessionExpiresAt?: number;
  tokenExpiresAt?: number | null;
  /** Why the session ended, when the server said so. */
  reason?: string;
  error?: string;
}

export interface AuthApi extends AuthState {
  client: AuthClient;
  /** The Phase 1 GitHubClient wired to the authenticated proxy; the access token is never available here. */
  github: GitHubClient;
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refresh: (opts?: { verify?: boolean }) => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);
const REVALIDATE_MS = 5 * 60_000;

export function AuthProvider({ children, client: injected }: { children: ReactNode; client?: AuthClient }) {
  const [client] = useState(() => injected ?? new AuthClient());
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = state.status;

  const refresh = useCallback(async (opts: { verify?: boolean } = {}) => {
    try {
      const s = await client.getSession(opts);
      if (s.authenticated) {
        setState({ status: 'authenticated', user: s.user, scope: s.scope, sessionExpiresAt: s.sessionExpiresAt, tokenExpiresAt: s.tokenExpiresAt });
      } else if (s.reason) {
        setState({ status: 'expired', reason: s.reason });
      } else {
        setState((prev) => (prev.status === 'authenticated' ? { status: 'expired', reason: 'expired' } : { status: 'anonymous' }));
      }
    } catch (e) {
      // A transient failure must not sign a signed-in user out; only an initial failure is surfaced.
      setState((prev) => (prev.status === 'authenticated' ? prev : { status: 'error', error: e instanceof Error ? e.message : 'Could not check your session.' }));
    }
  }, [client]);

  useEffect(() => {
    client.onUnauthorized = () => setState((prev) => (prev.status === 'authenticated' ? { status: 'expired', reason: 'unauthorized' } : prev));
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible' && statusRef.current === 'authenticated') void refresh(); };
    const onFocus = () => { if (statusRef.current === 'authenticated') void refresh(); };
    const timer = window.setInterval(() => { if (statusRef.current === 'authenticated') void refresh(); }, REVALIDATE_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus); client.onUnauthorized = undefined; };
  }, [client, refresh]);

  const github = useMemo(() => client.createGitHubClient(), [client]);
  const login = useCallback((returnTo?: string) => nav.redirect(client.loginUrl(returnTo)), [client]);
  const logout = useCallback(async () => {
    try { await client.logout(); } finally { setState({ status: 'anonymous' }); }
  }, [client]);

  const value = useMemo<AuthApi>(() => ({ ...state, client, github, login, logout, refresh }), [state, client, github, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
