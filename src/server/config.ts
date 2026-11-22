export const DEFAULT_PROXY_MAX_BODY_BYTES = 4_500_000; // Vercel serverless request-body limit is 4.5 MB

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. https://zipora.vercel.app — also used for the OAuth redirect URI and Origin checks. */
  appOrigin: string;
  secure: boolean;
  redirectUri: string;
  /** Space-separated OAuth scopes; empty for GitHub App user tokens (permissions come from the App). */
  scope: string;
  sessionTtlSeconds: number;
  /** [current, ...previous]; the first encrypts, all decrypt (key rotation). */
  secrets: string[];
  proxyMaxBodyBytes: number;
  cookieNames: { session: string; oauth: string };
}

/** Lists problems by variable NAME only; secret values are never included in messages. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid server configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export function loadConfig(env: Record<string, string | undefined>): AuthConfig {
  const problems: string[] = [];
  const need = (k: string): string => {
    const v = env[k]?.trim();
    if (!v) problems.push(`${k} is required`);
    return v ?? '';
  };
  const clientId = need('GITHUB_CLIENT_ID');
  const clientSecret = need('GITHUB_CLIENT_SECRET');
  const secrets: string[] = [];
  const current = need('SESSION_SECRET');
  if (current) {
    if (current.length < 32) problems.push('SESSION_SECRET must be at least 32 characters (generate with: openssl rand -base64 48)');
    secrets.push(current);
  }
  const previous = env.SESSION_SECRET_PREVIOUS?.trim();
  if (previous) {
    if (previous.length < 32) problems.push('SESSION_SECRET_PREVIOUS must be at least 32 characters');
    secrets.push(previous);
  }

  let appOrigin = '';
  let secure = false;
  const rawUrl = need('APP_URL');
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) problems.push('APP_URL must use https (http is allowed only for localhost)');
      else if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) problems.push('APP_URL must be an origin only (no path, query or credentials)');
      else { appOrigin = u.origin; secure = u.protocol === 'https:'; }
    } catch {
      problems.push('APP_URL is not a valid URL');
    }
  }

  let scope = (env.GITHUB_OAUTH_SCOPE ?? 'repo').trim();
  if (scope.toLowerCase() === 'none') scope = '';
  if (!/^[A-Za-z0-9:_, -]*$/.test(scope)) problems.push('GITHUB_OAUTH_SCOPE contains invalid characters');
  scope = scope.split(/[ ,]+/).filter(Boolean).join(' ');

  let sessionTtlSeconds = 7 * 24 * 3600;
  if (env.SESSION_TTL_SECONDS?.trim()) {
    const n = Number(env.SESSION_TTL_SECONDS);
    if (!Number.isInteger(n) || n < 300 || n > 30 * 24 * 3600) problems.push('SESSION_TTL_SECONDS must be an integer between 300 and 2592000');
    else sessionTtlSeconds = n;
  }

  let proxyMaxBodyBytes = DEFAULT_PROXY_MAX_BODY_BYTES;
  if (env.PROXY_MAX_BODY_BYTES?.trim()) {
    const n = Number(env.PROXY_MAX_BODY_BYTES);
    if (!Number.isInteger(n) || n < 1024) problems.push('PROXY_MAX_BODY_BYTES must be an integer of at least 1024');
    else proxyMaxBodyBytes = n;
  }

  if (problems.length > 0) throw new ConfigError(problems);
  const prefix = secure ? '__Host-' : '';
  return {
    clientId, clientSecret, appOrigin, secure, scope, sessionTtlSeconds, secrets, proxyMaxBodyBytes,
    redirectUri: `${appOrigin}/api/auth/callback`,
    cookieNames: { session: `${prefix}zipora_session`, oauth: `${prefix}zipora_oauth` },
  };
}
