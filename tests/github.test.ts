import { describe, expect, it } from 'vitest';
import { EngineError, GitHubClient } from '../src/engine';

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function make(responses: Array<Response | Error>, extra: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) {
  const sleeps: number[] = [];
  let i = 0;
  const client = new GitHubClient({
    token: 'secret-token', random: () => 0, now: () => 1_000_000,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: (async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r.clone();
    }) as typeof fetch,
    ...extra,
  });
  return { client, sleeps, calls: () => i };
}
const fail = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as EngineError; } throw new Error('expected failure'); };
const get = (c: GitHubClient) => c.request('GET', '/x');

describe('GitHubClient error handling', () => {
  it('maps statuses to actionable errors', async () => {
    expect((await fail(get(make([res(401)]).client))).code).toBe('AUTH');
    expect((await fail(get(make([res(403, { message: 'Resource not accessible' })]).client))).code).toBe('PERMISSION');
    expect((await fail(get(make([res(404)]).client))).code).toBe('NOT_FOUND');
    expect((await fail(get(make([res(422, { message: 'Update is not a fast forward' })]).client))).code).toBe('CONFLICT');
    expect((await fail(get(make([res(409, { message: 'x' })]).client))).code).toBe('CONFLICT');
    const e = await fail(get(make([res(422, { message: 'bad' })]).client));
    expect(e.code).toBe('GITHUB_API');
    expect(e.hint ?? e.message).toBeTruthy();
  });

  it('includes the detail GitHub puts in errors[] for validation failures', async () => {
    const e = await fail(get(make([res(422, { message: 'Repository creation failed.', errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }] })]).client));
    expect(e.code).toBe('GITHUB_API');
    expect(e.message).toContain('Repository creation failed.');
    expect(e.message).toContain('name already exists on this account');
    const noMsg = await fail(get(make([res(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] })]).client));
    expect(noMsg.message).toContain('Issue title missing_field');
  });

  it('never includes the token in error messages', async () => {
    const e = await fail(get(make([res(401)]).client));
    expect(JSON.stringify({ m: e.message, h: e.hint })).not.toContain('secret-token');
  });

  it('retries 5xx with backoff then succeeds', async () => {
    const { client, sleeps, calls } = make([res(502), res(503), res(200, { ok: 1 })]);
    expect(await get(client)).toEqual({ ok: 1 });
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    const { client, calls } = make([res(500)], { maxRetries: 2 });
    expect((await fail(get(client))).code).toBe('GITHUB_API');
    expect(calls()).toBe(3);
  });

  it('retries network errors, then reports NETWORK', async () => {
    const ok = make([new TypeError('x'), new TypeError('x'), res(200, { a: 1 })]);
    expect(await get(ok.client)).toEqual({ a: 1 });
    const dead = make([new TypeError('offline')], { maxRetries: 1 });
    expect((await fail(get(dead.client))).code).toBe('NETWORK');
  });

  it('waits out short secondary rate limits using Retry-After', async () => {
    const { client, sleeps } = make([res(403, { message: 'secondary rate limit' }, { 'retry-after': '2' }), res(200, {})]);
    await get(client);
    expect(sleeps).toEqual([2000]);
  });

  it('refuses to wait for a long primary rate limit and reports the reset time', async () => {
    const reset = String(1_000 + 3600);
    const { client, sleeps } = make([res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })]);
    const e = await fail(get(client));
    expect(e.code).toBe('RATE_LIMIT');
    expect(e.recoverable).toBe(false);
    expect(e.resetAt).toBeGreaterThan(1_000_000);
    expect(sleeps).toEqual([]);
  });

  it('times out hung requests', async () => {
    const client = new GitHubClient({
      token: 't', timeoutMs: 10, maxRetries: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch,
    });
    expect((await fail(get(client))).code).toBe('TIMEOUT');
  });

  it('cancels in flight', async () => {
    const ctl = new AbortController();
    const client = new GitHubClient({
      token: 't', maxRetries: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch,
    });
    const p = fail(client.request('GET', '/x', { signal: ctl.signal }));
    ctl.abort();
    expect((await p).code).toBe('CANCELLED');
  });

  it('rejects unsafe repository and branch names before any request', async () => {
    const { client, calls } = make([res(200)]);
    expect((await fail(client.getBranch('o/../x', 'r', 'main'))).code).toBe('INVALID_PATH');
    expect((await fail(client.getBranch('o', 'r', 'a..b'))).code).toBe('INVALID_PATH');
    expect(calls()).toBe(0);
  });
});
