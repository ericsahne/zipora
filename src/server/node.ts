import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_PROXY_MAX_BODY_BYTES } from './config.js';

/** Reads a Node request body, refusing more than `max` bytes. */
async function readBody(req: IncomingMessage, max: number): Promise<Uint8Array<ArrayBuffer> | 'too-large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > max) return 'too-large';
    chunks.push(b);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Adapts a Fetch-API handler (Request → Response) to the Node (req, res) signature Vercel Functions use. */
export function toNodeHandler(handler: (req: Request) => Promise<Response>, opts: { maxBodyBytes?: number } = {}) {
  const max = opts.maxBodyBytes ?? DEFAULT_PROXY_MAX_BODY_BYTES;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
      const url = new URL(req.url ?? '/', `${proto}://${host}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) for (const x of v) headers.append(k, x);
        else headers.set(k, v);
      }
      const method = (req.method ?? 'GET').toUpperCase();
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const read = await readBody(req, max);
        if (read === 'too-large') return sendJson(res, 413, { error: { code: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${max} bytes.` } });
        body = read;
      }
      const response = await handler(new Request(url, { method, headers, body }));
      res.statusCode = response.status;
      const cookies = response.headers.getSetCookie();
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
      if (cookies.length > 0) res.setHeader('set-cookie', cookies); // several Set-Cookie headers must stay separate
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Unexpected server error.' } });
      else res.end();
    }
  };
}
