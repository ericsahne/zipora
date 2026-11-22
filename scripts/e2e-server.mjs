// MOCKED-GITHUB end-to-end server. Serves the production build (dist/) with the headers from vercel.json and mounts the REAL
// Phase 2 API routes, but GitHub itself (OAuth + REST) is replaced by an in-memory fake. Nothing here talks to github.com.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createApp } from '../.e2e-build/src/server/app.js';
import { loadConfig } from '../.e2e-build/src/server/config.js';
import { toNodeHandler } from '../.e2e-build/src/server/node.js';
import { createFakeOAuth } from '../.e2e-build/tests/server/fakeOAuth.js';

const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const dist = join(process.cwd(), 'dist');
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
const config = loadConfig({
  GITHUB_CLIENT_ID: 'e2e-client-id', GITHUB_CLIENT_SECRET: 'e2e-client-secret-value',
  APP_URL: `http://localhost:${port}`, SESSION_SECRET: 'e2e-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz', GITHUB_OAUTH_SCOPE: 'repo',
});

const repo = (id, name, extra = {}) => ({ id, name, full_name: `octo-dev/${name}`, owner: { login: 'octo-dev' }, private: false, description: `${name} repository`, default_branch: 'main', html_url: `https://github.com/octo-dev/${name}`, permissions: { admin: true, push: true, pull: true }, archived: false, fork: false, pushed_at: '2026-10-01T00:00:00Z', ...extra });
const fresh = () => createFakeOAuth({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, gitFiles: { 'README.md': 'hello from the repo' },
  repos: [repo(1, 'site'), repo(2, 'notes', { private: true, description: 'Private notes' }), repo(3, 'readonly', { permissions: { admin: false, push: false, pull: true } }), repo(4, 'frozen', { archived: true })], orgs: ['acme'] });
const state = { oauth: fresh(), delay: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mockFetch = async (input, init) => {
  if (state.delay && String(input).endsWith('/git/blobs')) await sleep(state.delay);
  return state.oauth.fetch(input, init);
};
const app = await createApp(config, { fetch: mockFetch });
const api = toNodeHandler(app.handle);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const headersFor = (path) => {
  const out = {};
  for (const rule of vercel.headers ?? []) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (re.test(path)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
};
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith('/__mock/')) {
      const g = state.oauth.git;
      if (url.pathname === '/__mock/authorize') { // what GitHub would do after the user approves
        const { callback } = state.oauth.authorize(url.searchParams.get('authorize_url'));
        res.writeHead(302, { location: callback.pathname + callback.search }); return res.end();
      }
      if (url.pathname === '/__mock/reset') { state.oauth = fresh(); state.delay = 0; return json(res, { ok: true }); }
      if (url.pathname === '/__mock/state') return json(res, { files: g.files(), branches: g.branches(), commits: g.count('POST', '/git/commits'), blobs: g.count('POST', '/git/blobs'), repos: state.oauth.repos.map((r) => r.name), tokensIssued: state.oauth.state.issued.length, tokensLive: state.oauth.accessTokens.size });
      if (url.pathname === '/__mock/revoke') { state.oauth.accessTokens.clear(); return json(res, { ok: true }); }
      if (url.pathname === '/__mock/delay') { state.delay = Number(url.searchParams.get('ms') ?? 0); return json(res, { ok: true }); }
      if (url.pathname === '/__mock/fail-blobs') { g.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' ? new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }) : undefined); return json(res, { ok: true }); }
      return json(res, { error: 'unknown mock endpoint' }, 404);
    }
    if (url.pathname.startsWith('/api/')) return api(req, res);
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    let body;
    try { body = await readFile(file); } catch { file = join(dist, 'index.html'); body = await readFile(file); } // SPA fallback (vercel.json rewrite)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', ...headersFor(url.pathname) });
    res.end(body);
  } catch (e) {
    console.error('[e2e-server]', e);
    res.writeHead(500); res.end('e2e server error');
  }
}).listen(port, () => console.log(`MOCKED-GITHUB e2e server on http://localhost:${port}`));
