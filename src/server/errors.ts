export const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly setCookies: string[];
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, opts: { hint?: string; setCookies?: string[]; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.hint = opts.hint;
    this.setCookies = opts.setCookies ?? [];
    this.headers = opts.headers ?? {};
  }
}

export function respond(body: BodyInit | null, status: number, headers: Record<string, string> = {}, setCookies: string[] = []): Response {
  const h = new Headers({ ...SECURITY_HEADERS, ...headers });
  for (const c of setCookies) h.append('set-cookie', c);
  return new Response(body, { status, headers: h });
}

export function json(body: unknown, status = 200, setCookies: string[] = [], headers: Record<string, string> = {}): Response {
  return respond(JSON.stringify(body), status, { 'content-type': 'application/json; charset=utf-8', ...headers }, setCookies);
}

export function redirect(location: string, setCookies: string[] = []): Response {
  return respond(null, 302, { location }, setCookies);
}

export function errorResponse(e: ApiError): Response {
  return json({ error: { code: e.code, message: e.message, hint: e.hint } }, e.status, e.setCookies, e.headers);
}

const TOKEN_RE = /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g;

/** Removes GitHub token shapes and any explicitly supplied secrets from text destined for logs. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(TOKEN_RE, '[redacted-token]');
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[redacted]');
  return out;
}

export function logError(e: unknown, secrets: readonly string[] = []): void {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[zipora] ${redact(msg, secrets)}`);
}

/** Structured, redacted diagnostic line (shows up in Vercel's function logs). Never pass tokens or secrets in `data`. */
export function logInfo(event: string, data: Record<string, unknown>, secrets: readonly string[] = []): void {
  console.info(`[zipora] ${event} ${redact(JSON.stringify(data), secrets)}`);
}
