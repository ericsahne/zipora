import { createHash, randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  ByteBudget, EngineError, GitHubClient, assertDeployableFiles, bytesFile, encodeBase64Bytes, executeDeployment,
  gitBlobSha, inspectZip, planDeployment, readCentralDirectory, toBase64, type DeployOptions, type SourceFile,
} from '../src/engine';
import { createFakeGitHub } from './fakeGitHub';

const enc = new TextEncoder();
const target = { owner: 'o', repo: 'r', branch: 'main' };
const opts = (o: Partial<DeployOptions> = {}): DeployOptions => ({ targetDir: '', replaceExisting: true, deleteMissing: false, message: 'Deploy via ZIPORA', ...o });
const files = (o: Record<string, string>): SourceFile[] => Object.entries(o).map(([p, c]) => bytesFile(p, enc.encode(c)));
const setup = (initial: Record<string, string> = {}) => {
  const fake = createFakeGitHub(initial);
  const client = new GitHubClient({ token: 't', fetchImpl: fake.fetch, sleep: async () => {}, random: () => 0 });
  return { fake, client };
};
const gen = (fill: (z: JSZip) => void, o: Record<string, unknown> = {}) => {
  const z = new JSZip();
  fill(z);
  return z.generateAsync({ type: 'uint8array', ...o } as JSZip.JSZipGeneratorOptions<'uint8array'>);
};
const patch = (buf: Uint8Array, from: string, to: string) => {
  const a = Buffer.from(from), b = Buffer.from(to), out = Buffer.from(buf);
  for (let i = out.indexOf(a); i !== -1; i = out.indexOf(a, i + 1)) b.copy(out, i);
  return new Uint8Array(out);
};
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hangUntilAbort = (signal?: AbortSignal) =>
  new Promise<never>((_, rej) => signal?.addEventListener('abort', () => rej(new EngineError('CANCELLED', 'aborted')), { once: true }));

/* ───────────────────────── 1. Duplicate ZIP entries ───────────────────────── */
describe('1. duplicate ZIP entries are detected reliably', () => {
  it('flags two entries with the exact same filename, and deploys neither copy', async () => {
    const zip = await gen((z) => { z.file('aa.txt', 'FIRST'); z.file('bb.txt', 'SECOND'); z.file('cc.txt', 'ok'); });
    const r = await inspectZip(patch(zip, 'bb.txt', 'aa.txt'));
    expect(r.blocking).toBe(true);
    expect(r.issues.filter((i) => i.code === 'DUPLICATE_PATH')).toEqual([expect.objectContaining({ path: 'aa.txt', severity: 'error' })]);
    expect(r.files.map((f) => f.path)).toEqual(['cc.txt']); // ambiguous path excluded, not "last one wins"
  });

  it('flags entries that become identical after normalisation ("a/b.txt" vs "a\\b.txt")', async () => {
    const zip = await gen((z) => { z.file('a/b.txt', '1'); z.file('a_b.txt', '2'); });
    const r = await inspectZip(patch(zip, 'a_b.txt', 'a\\b.txt'));
    expect(r.blocking).toBe(true);
    expect(r.issues.some((i) => i.code === 'DUPLICATE_PATH' && i.path === 'a/b.txt')).toBe(true);
  });

  it('flags a file and a directory entry that share a name', async () => {
    const r = await inspectZip(await gen((z) => { z.file('x', '1'); z.folder('x'); }));
    expect(r.blocking).toBe(true);
    expect(r.issues.some((i) => i.code === 'FILE_DIRECTORY_CONFLICT' && i.path === 'x')).toBe(true);
  });

  it('readCentralDirectory lists every raw entry, duplicates and directories included', async () => {
    const zip = await gen((z) => { z.file('d/a.txt', '1'); z.file('d/b.txt', '2'); });
    const names = readCentralDirectory(patch(zip, 'd/b.txt', 'd/a.txt')).map((e) => e.name);
    expect(names.filter((n) => n === 'd/a.txt')).toHaveLength(2);
    expect(names).toContain('d/');
  });

  it('reads archives that have bytes prepended (self-extracting style) and empty archives', async () => {
    const zip = await gen((z) => { z.file('a.txt', 'A'); });
    const prefixed = new Uint8Array([...new Uint8Array(100).fill(7), ...zip]);
    expect(readCentralDirectory(prefixed).map((e) => e.name)).toEqual(['a.txt']);
    const empty = await inspectZip(await gen(() => {}));
    expect(empty.files).toEqual([]);
    expect(empty.blocking).toBe(false);
  });

  it('fails closed on a damaged directory instead of guessing', () => {
    expect(() => readCentralDirectory(new Uint8Array(10))).toThrow(EngineError);
    expect(() => readCentralDirectory(new Uint8Array(64))).toThrow(/not found/);
  });
});

/* ───────────────────── 2. Collisions rejected inside the engine ───────────────────── */
describe('2. the deployment engine itself rejects path collisions', () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    ['file vs directory', { x: '1', 'x/y': '2' }, 'PATH_COLLISION'],
    ['case-only collision', { 'A.txt': '1', 'a.txt': '2' }, 'PATH_COLLISION'],
    ['traversal path', { '../evil': '1' }, 'INVALID_PATH'],
    ['non-normalised path', { './a.txt': '1' }, 'INVALID_PATH'],
    ['.git target', { '.git/config': '1' }, 'INVALID_PATH'],
  ];
  it.each(cases)('executeDeployment rejects %s before any network call', async (_n, input, code) => {
    const { fake, client } = setup({ 'keep.txt': 'k' });
    const r = await executeDeployment({ client, target, files: files(input), options: opts() });
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe(code);
    expect(fake.calls).toEqual([]);
  });

  it('rejects exact duplicates handed to the engine directly', async () => {
    const { fake, client } = setup();
    const dup = [bytesFile('a', enc.encode('1')), bytesFile('a', enc.encode('2'))];
    const r = await executeDeployment({ client, target, files: dup, options: opts() });
    expect(r.error?.code).toBe('PATH_COLLISION');
    expect(fake.calls).toEqual([]);
  });

  it('planDeployment and assertDeployableFiles reject collisions on their own', async () => {
    expect(() => assertDeployableFiles(files({ x: '1', 'x/y/z': '2' }))).toThrow(/needs it to be a directory/);
    await expect(planDeployment(files({ x: '1', 'x/y': '2' }), [], { targetDir: '', replaceExisting: true, deleteMissing: false })).rejects.toMatchObject({ code: 'PATH_COLLISION' });
  });

  it('error message names the problem and says nothing was sent', async () => {
    const e = (() => { try { assertDeployableFiles(files({ x: '1', 'x/y': '2' })); } catch (err) { return err as EngineError; } })()!;
    expect(e.message).toContain('"x"');
    expect(e.hint).toContain('Nothing was sent to GitHub');
  });

  it('still rejects clashes with existing repository content (file/dir and submodule)', async () => {
    const existing = [{ path: 'docs', mode: '100644', type: 'blob' as const, sha: 'a' }, { path: 'vendor', mode: '160000', type: 'commit' as const, sha: 'b' }];
    await expect(planDeployment(files({ 'docs/readme.md': '1' }), existing, { targetDir: '', replaceExisting: true, deleteMissing: false })).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(planDeployment(files({ vendor: '1' }), existing, { targetDir: '', replaceExisting: true, deleteMissing: false })).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});

/* ───────────────────── 3. Memory efficiency: lazy ZIP + Base64 ───────────────────── */
describe('3. memory efficiency', () => {
  it('inspectZip returns lazy files: no bytes retained, hash precomputed, content readable on demand', async () => {
    const payload = randomBytes(300_000);
    const r = await inspectZip(await gen((z) => { z.file('big.bin', payload); z.file('t.txt', 'hello\n'); }));
    for (const f of r.files) expect(f).not.toHaveProperty('data');
    const big = r.files.find((f) => f.path === 'big.bin')!;
    expect(big.size).toBe(300_000);
    expect(big.sha).toBe(createHash('sha1').update('blob 300000\0').update(payload).digest('hex'));
    expect(Buffer.from(await big.read()).equals(payload)).toBe(true);
    expect(Buffer.from(await big.read()).equals(payload)).toBe(true); // repeatable
  });

  it('gitBlobSha matches published git vectors', async () => {
    expect(await gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'); // git hash-object of an empty file
    expect(await gitBlobSha(enc.encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a'); // echo hello | git hash-object --stdin
  });

  it('base64 encoder is byte-identical to Buffer for every padding case and a 3 MB random input', () => {
    for (let n = 0; n <= 20; n++) {
      const d = randomBytes(n);
      expect(toBase64(d)).toBe(d.toString('base64'));
    }
    const big = randomBytes(3_000_001);
    expect(Buffer.from(encodeBase64Bytes(big)).toString('latin1')).toBe(big.toString('base64'));
  });

  it('createBlob sends a binary body (not a giant string) that decodes back to the original bytes', async () => {
    let seen: unknown;
    const data = randomBytes(10_000);
    const client = new GitHubClient({ token: 't', fetchImpl: (async (_u: unknown, init?: RequestInit) => { seen = init?.body; return new Response('{"sha":"abc"}', { status: 201 }); }) as typeof fetch });
    await client.createBlob('o', 'r', data);
    expect(seen).toBeInstanceOf(Blob);
    const parsed = JSON.parse(await (seen as Blob).text());
    expect(parsed.encoding).toBe('base64');
    expect(Buffer.from(parsed.content, 'base64').equals(data)).toBe(true);
  });

  it('ByteBudget blocks until memory is released, lets an oversize item run alone, and wakes on abort', async () => {
    const b = new ByteBudget(10);
    await b.acquire(6);
    let second = false;
    const p = b.acquire(6).then(() => { second = true; });
    await sleepMs(10);
    expect(second).toBe(false);
    b.release(6);
    await p;
    expect(second).toBe(true);
    b.release(6);
    await b.acquire(1000); // larger than the limit: allowed only because nothing else is held
    const ctl = new AbortController();
    const waiter = b.acquire(1, ctl.signal);
    ctl.abort();
    await expect(waiter).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('uploads never hold more than maxInflightBytes of file data at once', async () => {
    const { fake, client } = setup();
    const MB = 1024 * 1024;
    const mk = (i: number) => { const d = new Uint8Array(MB); d[0] = i; d[1] = i >> 8; return d; };
    const src: SourceFile[] = [];
    for (let i = 0; i < 12; i++) src.push({ path: `f${i}.bin`, size: MB, sha: await gitBlobSha(mk(i)), read: async () => { active++; maxActive = Math.max(maxActive, active); return mk(i); } });
    let active = 0, maxActive = 0;
    const orig = client.createBlob.bind(client);
    client.createBlob = async (...a) => { try { await sleepMs(5); return await orig(...a); } finally { active--; } };
    const r = await executeDeployment({ client, target, files: src, options: opts(), concurrency: 8, maxInflightBytes: 3 * MB });
    expect(r.status).toBe('success');
    expect(Object.keys(fake.files())).toHaveLength(12);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1); // it really ran in parallel
  });

  it('a hash mismatch reported by GitHub aborts before any commit', async () => {
    const { fake, client } = setup();
    fake.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' ? new Response('{"sha":"deadbeef"}', { status: 201 }) : undefined);
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts() });
    expect(r.error?.code).toBe('UPLOAD_FAILED');
    expect(fake.count('POST', '/git/commits')).toBe(0);
  });
});

/* ───────────────────── 4. Upload concurrency and cancellation ───────────────────── */
describe('4. upload concurrency and cancellation', () => {
  it('never exceeds the configured number of parallel uploads', async () => {
    const { client } = setup();
    let active = 0, maxActive = 0;
    const orig = client.createBlob.bind(client);
    client.createBlob = async (...a) => { active++; maxActive = Math.max(maxActive, active); try { await sleepMs(3); return await orig(...a); } finally { active--; } };
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, `c${i}`]));
    const r = await executeDeployment({ client, target, files: files(many), options: opts(), concurrency: 3 });
    expect(r.status).toBe('success');
    expect(maxActive).toBe(3);
  });

  it('a fatal error aborts sibling in-flight uploads instead of letting them run on', async () => {
    const { client } = setup();
    let n = 0, abortedSiblings = 0;
    client.createBlob = async (_o, _r, _d, signal) => {
      if (n++ === 0) throw new EngineError('AUTH', 'token revoked');
      try { return await hangUntilAbort(signal); } catch (e) { abortedSiblings++; throw e; }
    };
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, `c${i}`]));
    const r = await executeDeployment({ client, target, files: files(many), options: opts(), concurrency: 4 });
    expect(r.error?.code).toBe('AUTH');
    expect(abortedSiblings).toBe(3); // the other three in-flight requests were cancelled, none left hanging
  });

  it('cancels during planning (hashing) with no write requests sent', async () => {
    const { fake, client } = setup();
    const ctl = new AbortController();
    const lazy = (p: string): SourceFile => ({ path: p, size: 1, read: async () => { ctl.abort(); return new Uint8Array([1]); } });
    const r = await executeDeployment({ client, target, files: [lazy('a'), lazy('b')], options: opts(), signal: ctl.signal });
    expect(r.status).toBe('cancelled');
    expect(fake.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('cancels while uploads are queued behind the memory budget, without hanging', async () => {
    const { fake, client } = setup();
    const ctl = new AbortController();
    client.createBlob = async (_o, _r, _d, signal) => hangUntilAbort(signal);
    const p = executeDeployment({ client, target, files: files({ a: 'x', b: 'y', c: 'z' }), options: opts(), signal: ctl.signal, concurrency: 3, maxInflightBytes: 1 });
    setTimeout(() => ctl.abort(), 20);
    const r = await p;
    expect(r.status).toBe('cancelled');
    expect(fake.head()).toBe('c0');
  });

  it('cancels promptly while the client is sleeping between retries', async () => {
    const fake = createFakeGitHub();
    const client = new GitHubClient({ token: 't', fetchImpl: fake.fetch, random: () => 0 }); // real sleep: 500 ms backoff
    fake.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' ? new Response('{}', { status: 500 }) : undefined);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 40);
    const t0 = Date.now();
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts(), signal: ctl.signal });
    expect(r.status).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(400);
    expect(fake.head()).toBe('c0');
  });

  it('once the commit step starts it always finishes: cancel there cannot leave a half-applied deployment', async () => {
    const { fake, client } = setup();
    const ctl = new AbortController();
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts(), signal: ctl.signal, onEvent: (e) => { if (e.stage === 'commit') ctl.abort(); } });
    expect(r.status).toBe('success');
    expect(fake.head()).toBe(r.commitSha);
  });
});

/* ───────────────────── 5. Retry and conflict recovery ───────────────────── */
describe('5. GitHub retry and conflict recovery', () => {
  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

  it.each([401, 404, 422])('does not retry non-recoverable status %i', async (status) => {
    let calls = 0;
    const client = new GitHubClient({ token: 't', sleep: async () => {}, fetchImpl: (async () => { calls++; return res(status, { message: 'nope' }); }) as typeof fetch });
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(EngineError);
    expect(calls).toBe(1);
  });

  it('a rate limit pauses every concurrent request, not only the one that hit it', async () => {
    let t = 1_000_000, fetches = 0;
    const waiting: Array<() => void> = [];
    const sleeps: number[] = [];
    const client = new GitHubClient({
      token: 't', now: () => t,
      sleep: (ms) => new Promise<void>((resolve) => { sleeps.push(ms); waiting.push(() => { t += ms; resolve(); }); }),
      fetchImpl: (async () => (++fetches === 1 ? res(429, { message: 'secondary rate limit' }, { 'retry-after': '2' }) : res(200, { ok: true }))) as typeof fetch,
    });
    const a = client.request('GET', '/a');
    await sleepMs(10); // A has hit the limit and is waiting
    const b = client.request('GET', '/b'); // B starts during the pause
    await sleepMs(10);
    expect(fetches).toBe(1); // B has NOT hit the network yet
    expect(sleeps).toEqual([2000, 2000]);
    waiting.forEach((w) => w());
    await Promise.all([a, b]);
    expect(fetches).toBe(3);
  });

  it('scales the request timeout with upload size', () => {
    const c = new GitHubClient({ token: 't', timeoutMs: 30_000 });
    expect(c.requestTimeoutMs(0)).toBe(30_000);
    expect(c.requestTimeoutMs(50_000_000)).toBe(30_000 + 1_000_000);
  });

  it('rebases onto an external push, keeping the other person\'s files', async () => {
    const { fake, client } = setup({ 'a.txt': 'orig' });
    let moved = false;
    fake.onRequest = (m) => { if (m === 'PATCH' && !moved) { moved = true; fake.moveBranch('main', { 'other.txt': 'from someone else' }); } return undefined; };
    const r = await executeDeployment({ client, target, files: files({ 'n.txt': 'new' }), options: opts() });
    expect(r.status).toBe('success');
    expect(fake.files()).toEqual({ 'a.txt': 'orig', 'other.txt': 'from someone else', 'n.txt': 'new' });
    expect(fake.count('POST', '/git/blobs')).toBe(1); // not re-uploaded on the retry
  });

  it('reports no-changes if the concurrent push already contained identical content', async () => {
    const { fake, client } = setup();
    let moved = false;
    fake.onRequest = (m) => { if (m === 'PATCH' && !moved) { moved = true; fake.moveBranch('main', { 'n.txt': 'new' }); } return undefined; };
    const r = await executeDeployment({ client, target, files: files({ 'n.txt': 'new' }), options: opts() });
    expect(r.status).toBe('no-changes');
  });

  it('gives up with CONFLICT when the branch keeps moving, leaving nothing half-applied', async () => {
    const { fake, client } = setup();
    fake.onRequest = (m) => { if (m === 'PATCH') fake.moveBranch(); return undefined; };
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts(), maxConflictRetries: 2 });
    expect(r.error?.code).toBe('CONFLICT');
    expect(r.logs.filter((l) => /re-planning/.test(l.message))).toHaveLength(2);
    expect(fake.files()).toEqual({}); // our files never reached the branch
  });

  it('treats a branch update whose response was lost as success when the branch already has our commit', async () => {
    const { fake, client } = setup();
    let first = true;
    fake.afterRequest = (m) => { if (m === 'PATCH' && first) { first = false; throw new TypeError('connection reset'); } return undefined; };
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts() });
    expect(r.status).toBe('success');
    expect(r.commitSha).toBe(fake.head());
    expect(fake.count('POST', '/git/commits')).toBe(1);
    expect(r.logs.some((l) => /already points at our commit/.test(l.message))).toBe(true);
  });

  it('does the same when a new branch was created but the response was lost', async () => {
    const { fake, client } = setup({ 'a.txt': 'base' });
    let first = true;
    fake.afterRequest = (m, p) => { if (m === 'POST' && p === '/git/refs' && first) { first = false; throw new TypeError('connection reset'); } return undefined; };
    const r = await executeDeployment({ client, target: { ...target, branch: 'feature/x' }, files: files({ 'b.txt': 'b' }), options: opts({ createBranchFrom: 'main' }) });
    expect(r.status).toBe('success');
    expect(fake.files('feature/x')).toEqual({ 'a.txt': 'base', 'b.txt': 'b' });
  });

  it('does NOT claim success when the failed update did not land', async () => {
    const { fake, client } = setup();
    fake.onRequest = (m) => (m === 'PATCH' ? new Response('{}', { status: 502 }) : undefined);
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts() });
    expect(r.status).toBe('failed');
    expect(fake.head()).toBe('c0');
  });
});
