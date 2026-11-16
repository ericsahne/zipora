import { describe, expect, it } from 'vitest';
import { bytesFile, executeDeployment, formatLogs, GitHubClient, planDeployment, TREE_CHUNK, type DeployOptions, type SourceFile } from '../src/engine';
import { createFakeGitHub, type FakeGitHub } from './fakeGitHub';

const enc = new TextEncoder();
const files = (o: Record<string, string>): SourceFile[] => Object.entries(o).map(([path, c]) => bytesFile(path, enc.encode(c)));
const target = { owner: 'o', repo: 'r', branch: 'main' };
const opts = (o: Partial<DeployOptions> = {}): DeployOptions => ({ targetDir: '', replaceExisting: true, deleteMissing: false, message: 'Deploy via ZIPORA', ...o });
const setup = async (initial: Record<string, string> = {}) => {
  const fake = createFakeGitHub(initial);
  const client = new GitHubClient({ token: 't', fetchImpl: fake.fetch, sleep: async () => {}, random: () => 0 });
  return { fake, client };
};
const blobCalls = (f: FakeGitHub) => f.count('POST', '/git/blobs');

describe('planDeployment', () => {
  const existing = [
    { path: 'keep.txt', mode: '100644', type: 'blob' as const, sha: 'x' },
    { path: 'site/old.txt', mode: '100644', type: 'blob' as const, sha: 'y' },
    { path: 'site/sub', mode: '040000', type: 'tree' as const, sha: 'z' },
  ];
  it('classifies add/update/unchanged/skipped and limits deletions to targetDir', async () => {
    const plan = await planDeployment(files({ 'new.txt': 'n', 'old.txt': 'changed' }), existing, { targetDir: 'site', replaceExisting: true, deleteMissing: true });
    expect(plan.add.map((f) => f.path)).toEqual(['site/new.txt']);
    expect(plan.update.map((f) => f.path)).toEqual(['site/old.txt']);
    expect(plan.delete).toEqual([]);
    const p2 = await planDeployment(files({ 'zzz.txt': 'q' }), existing, { targetDir: 'site', replaceExisting: false, deleteMissing: true });
    expect(p2.delete).toEqual(['site/old.txt']); // keep.txt outside targetDir is never touched
    const p3 = await planDeployment(files({ 'old.txt': 'changed' }), existing, { targetDir: 'site', replaceExisting: false, deleteMissing: false });
    expect(p3.skippedExisting).toEqual(['site/old.txt']);
  });
  it('blocks directory/file clashes with the repository', async () => {
    await expect(planDeployment(files({ sub: 'x' }), existing, { targetDir: 'site', replaceExisting: true, deleteMissing: false })).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(planDeployment(files({ 'x/y': 'x' }), existing, { targetDir: '', replaceExisting: true, deleteMissing: false })).resolves.toBeDefined();
    await expect(planDeployment(files({ 'y': 'x' }), existing, { targetDir: 'keep.txt', replaceExisting: true, deleteMissing: false })).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});

describe('executeDeployment', () => {
  it('deploys nested files in exactly one commit via the Git Data API', async () => {
    const { fake, client } = await setup({ 'README.md': 'hi', 'unrelated.txt': 'stay' });
    const r = await executeDeployment({ client, target, files: files({ 'a/b/c.txt': 'C', 'README.md': 'new' }), options: opts() });
    expect(r.status).toBe('success');
    expect(r.counts).toMatchObject({ added: 1, updated: 1 });
    expect(fake.files()).toEqual({ 'README.md': 'new', 'unrelated.txt': 'stay', 'a/b/c.txt': 'C' });
    expect(fake.count('POST', '/git/commits')).toBe(1);
    expect(fake.commitParents(fake.head()!)).toEqual(['c0']);
    expect(r.commitUrl).toBe(`https://github.com/o/r/commit/${r.commitSha}`);
    expect(formatLogs(r.logs)).toContain('Deployed commit');
  });

  it('creates no commit when nothing changed and uploads no blobs', async () => {
    const { fake, client } = await setup({ 'a.txt': 'same' });
    const r = await executeDeployment({ client, target, files: files({ 'a.txt': 'same' }), options: opts() });
    expect(r.status).toBe('no-changes');
    expect(blobCalls(fake)).toBe(0);
    expect(fake.count('POST', '/git/commits')).toBe(0);
  });

  it('leaves existing files untouched when replace is off', async () => {
    const { fake, client } = await setup({ 'a.txt': 'old' });
    const r = await executeDeployment({ client, target, files: files({ 'a.txt': 'new', 'b.txt': 'b' }), options: opts({ replaceExisting: false }) });
    expect(r.status).toBe('success');
    expect(fake.files()).toEqual({ 'a.txt': 'old', 'b.txt': 'b' });
    expect(r.counts.skipped).toBe(1);
  });

  it('deletes only inside the target directory when requested', async () => {
    const { fake, client } = await setup({ 'root.txt': 'r', 'site/gone.txt': 'g', 'site/stay.txt': 's' });
    const r = await executeDeployment({ client, target, files: files({ 'stay.txt': 's', 'fresh.txt': 'f' }), options: opts({ targetDir: 'site', deleteMissing: true }) });
    expect(r.counts.deleted).toBe(1);
    expect(Object.keys(fake.files()).sort()).toEqual(['root.txt', 'site/fresh.txt', 'site/stay.txt']);
  });

  it('recovers from transient 500s on blob upload', async () => {
    const { fake, client } = await setup();
    let failures = 2;
    fake.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' && failures-- > 0 ? new Response('{}', { status: 500 }) : undefined);
    const r = await executeDeployment({ client, target, files: files({ 'a': '1', 'b': '2' }), options: opts() });
    expect(r.status).toBe('success');
    expect(fake.files()).toEqual({ a: '1', b: '2' });
  });

  it('is atomic: a permanently failing upload creates no commit and leaves the branch unchanged', async () => {
    const { fake, client } = await setup({ 'a.txt': 'orig' });
    fake.onRequest = (m, p, body) => (m === 'POST' && p === '/git/blobs' && body.content === Buffer.from('bad').toString('base64') ? new Response('{}', { status: 500 }) : undefined);
    const r = await executeDeployment({ client, target, files: files({ good: 'ok', bad: 'bad' }), options: opts() });
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('UPLOAD_FAILED');
    expect(r.error?.recoverable).toBe(true);
    expect(r.counts.failed).toBe(1);
    expect(fake.head()).toBe('c0');
    expect(fake.count('POST', '/git/commits')).toBe(0);
  });

  it('stops immediately on fatal auth errors', async () => {
    const { fake, client } = await setup();
    fake.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' ? new Response('{}', { status: 401 }) : undefined);
    const r = await executeDeployment({ client, target, files: files({ a: '1', b: '2', c: '3' }), options: opts(), concurrency: 1 });
    expect(r.error?.code).toBe('AUTH');
    expect(blobCalls(fake)).toBe(1);
  });

  it('cancels before commit without modifying the repository', async () => {
    const { fake, client } = await setup({ 'a.txt': 'orig' });
    const ctl = new AbortController();
    const r = await executeDeployment({ client, target, files: files({ x: '1', y: '2' }), options: opts(), signal: ctl.signal, onEvent: (e) => { if (e.stage === 'processing') ctl.abort(); } });
    expect(r.status).toBe('cancelled');
    expect(fake.head()).toBe('c0');
    expect(fake.count('POST', '/git/commits')).toBe(0);
  });

  it('rebases once when the branch moves during deployment, without re-uploading blobs', async () => {
    const { fake, client } = await setup({ 'a.txt': 'orig' });
    let moved = false;
    fake.onRequest = (m) => { if (m === 'PATCH' && !moved) { moved = true; fake.moveBranch(); } return undefined; };
    const r = await executeDeployment({ client, target, files: files({ 'n.txt': 'new' }), options: opts() });
    expect(r.status).toBe('success');
    expect(r.logs.some((l) => /moved/i.test(l.message))).toBe(true);
    expect(blobCalls(fake)).toBe(1);
    expect(fake.files()['n.txt']).toBe('new');
  });

  it('reports CONFLICT when the branch keeps moving', async () => {
    const { fake, client } = await setup();
    fake.onRequest = (m) => { if (m === 'PATCH') fake.moveBranch(); return undefined; };
    const r = await executeDeployment({ client, target, files: files({ a: '1' }), options: opts(), maxConflictRetries: 1 });
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('CONFLICT');
  });

  it('creates a missing branch from a base branch', async () => {
    const { fake, client } = await setup({ 'a.txt': 'base' });
    const r = await executeDeployment({ client, target: { ...target, branch: 'feature/zip' }, files: files({ 'b.txt': 'b' }), options: opts({ createBranchFrom: 'main' }) });
    expect(r.status).toBe('success');
    expect(fake.files('feature/zip')).toEqual({ 'a.txt': 'base', 'b.txt': 'b' });
    expect(fake.files('main')).toEqual({ 'a.txt': 'base' });
  });

  it('fails clearly for a missing branch with no base, and for truncated trees', async () => {
    const a = await setup();
    const r1 = await executeDeployment({ client: a.client, target: { ...target, branch: 'nope' }, files: files({ a: '1' }), options: opts() });
    expect(r1.error?.code).toBe('NOT_FOUND');
    const b = await setup();
    b.fake.truncated = true;
    const r2 = await executeDeployment({ client: b.client, target, files: files({ a: '1' }), options: opts() });
    expect(r2.error?.code).toBe('TREE_TRUNCATED');
    expect(b.fake.count('POST', '/git/blobs')).toBe(0);
  });

  it('rejects empty commit messages and empty deployments', async () => {
    const { client } = await setup();
    expect((await executeDeployment({ client, target, files: files({ a: '1' }), options: opts({ message: '  ' }) })).error?.code).toBe('BLOCKED');
    expect((await executeDeployment({ client, target, files: [], options: opts() })).error?.code).toBe('BLOCKED');
  });

  it('stages tree creation for large deployments but still makes a single commit', async () => {
    const { fake, client } = await setup();
    const many = Object.fromEntries(Array.from({ length: TREE_CHUNK * 2 + 1 }, (_, i) => [`f/${i}.txt`, `c${i}`]));
    const r = await executeDeployment({ client, target, files: files(many), options: opts(), concurrency: 8 });
    expect(r.status).toBe('success');
    expect(fake.count('POST', '/git/trees')).toBe(3);
    expect(fake.count('POST', '/git/commits')).toBe(1);
    expect(Object.keys(fake.files())).toHaveLength(TREE_CHUNK * 2 + 1);
  });
});
