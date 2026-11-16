export interface CookieOptions {
  secure: boolean;
  maxAge?: number;
  sameSite?: 'Lax' | 'Strict';
}

const NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const VALUE_RE = /^[A-Za-z0-9._~+/=-]*$/;

/** HttpOnly + Path=/ always (required by the __Host- prefix); Secure when the app is served over https. */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  if (!NAME_RE.test(name)) throw new Error('Invalid cookie name');
  if (!VALUE_RE.test(value)) throw new Error('Invalid cookie value');
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAge))}`);
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { secure, maxAge: 0 });
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !out.has(k)) out.set(k, v); // first occurrence wins
  }
  return out;
}
