/** Safe GitHub-access diagnostics. Contains no tokens, secrets or cookies; shared by the server and the UI. */
export type TokenKind = 'oauth-app' | 'github-app-user' | 'unknown';

export interface Diagnosis { code: string; severity: 'error' | 'warn' | 'info'; message: string }

export interface DiagnoseReport {
  checkedAt: string;
  token: {
    /** Derived from the public token prefix (gho_ = OAuth App, ghu_ = GitHub App user token). */
    kind: TokenKind;
    /** First 8 hex chars of SHA-256(token): proves every check used the same token without revealing it. */
    fingerprint: string;
    sameTokenForAllCalls: boolean;
  };
  user: { status: number; login?: string; message?: string; matchesSession: boolean; grantedScopes: string[] | null; acceptedScopes: string | null };
  repos: { status: number; message?: string; count: number; publicCount: number; privateCount: number; pages: number; truncated: boolean; sample: string[] };
  repoCheck?: { name: string; status: number; message?: string; private?: boolean; canPush?: boolean; branches?: { status: number; count?: number; message?: string } };
  installations?: { status: number; count?: number; message?: string };
  rateLimit: { remaining: string | null; reset: string | null };
  diagnosis: Diagnosis[];
}
