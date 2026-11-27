import type { IncomingMessage, ServerResponse } from 'node:http';
import { vercelHandler } from '../src/server/runtime.js';

const run = vercelHandler((app) => app.github);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url) {
    const u = new URL(req.url, 'http://localhost');
    const ghPath = u.searchParams.get('__gh_path');
    if (ghPath !== null) {
      u.searchParams.delete('__gh_path');
      const safePath = ghPath.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
      const qs = u.searchParams.toString();
      req.url = `/api/github/${safePath}${qs ? `?${qs}` : ''}`;
    }
  }
  return run(req, res);
}
