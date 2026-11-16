import { createHash } from 'node:crypto';

type Entry = { sha: string; mode: string };
export type RequestHook = (method: string, path: string, body: any) => Response | undefined;
export type AfterHook = (method: string, path: string, body: any, response: Response) => Response | undefined;

export interface FakeGitHub {
  calls: string[];
  truncated: boolean;
  /** Runs before the request is handled; returning a Response short-circuits it. */
  onRequest: RequestHook | undefined;
  /** Runs AFTER the request was applied; may return a different response or throw (simulates a lost response). */
  afterRequest: AfterHook | undefined;
  count(method: string, suffix: string): number;
  files(b?: string): Record<string, string>;
  head(b?: string): string | undefined;
  branches(): string[];
  commitParents(sha: string): string[] | undefined;
  /** Simulates another user pushing: new commit on top of the branch, optionally adding files. */
  moveBranch(b?: string, add?: Record<string, string>): void;
  fetch: typeof fetch;
}

/** In-memory implementation of the Git Data API endpoints the engine uses. Not GitHub itself. */
export function createFakeGitHub(initial: Record<string, string> = {}, branch = 'main'): FakeGitHub {
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, Map<string, Entry>>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const refs = new Map<string, string>();
  let n = 0;
  const calls: string[] = [];

  // Independent of the engine's own hash code, so deploy tests also cross-check gitBlobSha.
  const addBlob = (data: Uint8Array): string => {
    const sha = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    blobs.set(sha, data);
    return sha;
  };
  const enc = new TextEncoder();
  const root = new Map<string, Entry>();
  for (const [p, c] of Object.entries(initial)) root.set(p, { sha: addBlob(enc.encode(c)), mode: '100644' });
  trees.set('t0', root);
  commits.set('c0', { tree: 't0', parents: [] });
  refs.set(branch, 'c0');

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fake: FakeGitHub = {
    calls,
    truncated: false,
    onRequest: undefined,
    afterRequest: undefined,
    count: (method, suffix) => calls.filter((c) => c.startsWith(method + ' ') && c.endsWith(suffix)).length,
    files(b = branch) {
      const out: Record<string, string> = {};
      const c = commits.get(refs.get(b)!)!;
      for (const [p, e] of trees.get(c.tree)!) out[p] = new TextDecoder().decode(blobs.get(e.sha)!);
      return out;
    },
    head: (b = branch) => refs.get(b),
    branches: () => [...refs.keys()],
    commitParents: (sha) => commits.get(sha)?.parents,
    moveBranch(b = branch, add = {}) {
      const parent = refs.get(b)!;
      const tree = new Map(trees.get(commits.get(parent)!.tree)!);
      for (const [p, c] of Object.entries(add)) tree.set(p, { sha: addBlob(enc.encode(c)), mode: '100644' });
      const tid = `t${++n}`;
      trees.set(tid, tree);
      const id = `c${++n}`;
      commits.set(id, { tree: tid, parents: [parent] });
      refs.set(b, id);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
      calls.push(`${method} ${url.pathname}`);
      let body: any;
      if (init?.body) body = JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body as Blob).text());
      const injected: Response | undefined = fake.onRequest?.(method, path, body);
      if (injected) return injected;
      const response = await handle(method, path, body);
      return fake.afterRequest?.(method, path, body, response) ?? response;
    }) as typeof fetch,
  };

  async function handle(method: string, path: string, body: any): Promise<Response> {
    let m: RegExpMatchArray | null;
    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = refs.get(decodeURIComponent(m[1]));
      return sha ? json({ object: { sha } }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(.+)$/))) {
      const c = commits.get(m[1]);
      return c ? json({ sha: m[1], tree: { sha: c.tree } }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(.+)$/))) {
      const t = trees.get(m[1]);
      if (!t) return json({ message: 'Not Found' }, 404);
      return json({ truncated: fake.truncated, tree: [...t].map(([p, e]) => ({ path: p, mode: e.mode, type: 'blob', sha: e.sha })) });
    }
    if (method === 'POST' && path === '/git/blobs') {
      return json({ sha: addBlob(Uint8Array.from(Buffer.from(body.content, 'base64'))) }, 201);
    }
    if (method === 'POST' && path === '/git/trees') {
      const next = new Map(trees.get(body.base_tree)!);
      for (const e of body.tree as { path: string; mode: string; sha: string | null }[]) {
        if (e.sha === null) next.delete(e.path);
        else if (!blobs.has(e.sha)) return json({ message: 'Invalid sha' }, 422);
        else next.set(e.path, { sha: e.sha, mode: e.mode });
      }
      const id = `t${++n}`;
      trees.set(id, next);
      return json({ sha: id }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      const id = `c${++n}`;
      commits.set(id, { tree: body.tree, parents: body.parents });
      return json({ sha: id }, 201);
    }
    if (method === 'PATCH' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const b = decodeURIComponent(m[1]);
      if (!commits.get(body.sha)?.parents.includes(refs.get(b)!)) return json({ message: 'Update is not a fast forward' }, 422);
      refs.set(b, body.sha);
      return json({});
    }
    if (method === 'POST' && path === '/git/refs') {
      const b = String(body.ref).replace('refs/heads/', '');
      if (refs.has(b)) return json({ message: 'Reference already exists' }, 422);
      refs.set(b, body.sha);
      return json({}, 201);
    }
    return json({ message: `unhandled ${method} ${path}` }, 500);
  }
  return fake;
}
