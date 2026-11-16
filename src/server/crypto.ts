import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();

export const b64u = {
  enc: (b: Uint8Array): string => Buffer.from(b).toString('base64url'),
  dec: (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64url')),
};

export interface Keys { enc: CryptoKey[]; mac: CryptoKey[] }

/** Derives independent AES-GCM and HMAC keys from each secret with HKDF-SHA256. */
export async function deriveKeys(secrets: readonly string[]): Promise<Keys> {
  const enc: CryptoKey[] = [];
  const mac: CryptoKey[] = [];
  const salt = te.encode('zipora/v1');
  for (const s of secrets) {
    const base = await subtle.importKey('raw', te.encode(s), 'HKDF', false, ['deriveKey']);
    enc.push(await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('session-encryption') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    mac.push(await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('csrf-mac') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']));
  }
  return { enc, mac };
}

/** AES-256-GCM. `purpose` is authenticated as AAD so a cookie sealed for one use cannot be replayed as another. */
export async function seal(keys: Keys, purpose: string, payload: unknown): Promise<string> {
  const iv = new Uint8Array(randomBytes(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(purpose) }, keys.enc[0], te.encode(JSON.stringify(payload))));
  return `v1.${b64u.enc(iv)}.${b64u.enc(ct)}`;
}

/** Returns null (never throws) for anything that is not a valid, untampered value sealed for `purpose`. */
export async function open<T>(keys: Keys, purpose: string, sealed: string): Promise<T | null> {
  const [v, ivPart, ctPart, extra] = sealed.split('.');
  if (v !== 'v1' || !ivPart || !ctPart || extra !== undefined) return null;
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try { iv = b64u.dec(ivPart); ct = b64u.dec(ctPart); } catch { return null; }
  if (iv.length !== 12) return null;
  for (const key of keys.enc) {
    try {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(purpose) }, key, ct);
      return JSON.parse(new TextDecoder().decode(pt)) as T;
    } catch { /* wrong key or tampered: try the next key */ }
  }
  return null;
}

async function mac(key: CryptoKey, sid: string): Promise<string> {
  return b64u.enc(new Uint8Array(await subtle.sign('HMAC', key, te.encode(`csrf|${sid}`))));
}

/** Stateless CSRF token bound to the session id; unreadable by other origins. */
export const csrfToken = (keys: Keys, sid: string): Promise<string> => mac(keys.mac[0], sid);

export async function csrfMatches(keys: Keys, sid: string, supplied: string): Promise<boolean> {
  let ok = false;
  for (const key of keys.mac) if (timingSafeEqualStr(await mac(key, sid), supplied)) ok = true;
  return ok;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export const randomToken = (bytes = 32): string => b64u.enc(new Uint8Array(randomBytes(bytes)));
export const sha256b64u = (s: string): string => createHash('sha256').update(s).digest('base64url');
