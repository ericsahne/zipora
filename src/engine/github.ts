import { EngineError } from './errors';
import { encodeBase64Bytes } from './hash';
import type { TreeEntry } from './types';

export interface ClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; must reject with CANCELLED when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Longest rate-limit wait the client will sit through before giving up. */
  maxRateLimitWaitMs?: number;
}

export interface ReqOptions { body?: unknown; rawBody?: Blob; signal?: AbortSignal }
export interface BranchHead { commitSha: string; treeSha: string }
export interface NewTreeEntry { path: string; mode: string; type: 'blob'; sha: string | null }

const cancelled = () => new EngineError('CANCELLED', 'Deployment cancelled.');

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(cancelled()); }, { once: true });
  });

const enc = new TextEncoder();
const BLOB_PREFIX = enc.encode('{"content":"');
const BLOB_SUFFIX = enc.encode('","encoding":"base64"}');

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const REF_RE = /^(?!\/)(?!.*\/\/)(?!.*\.\.)[^\s~^:?*[\\\u0000-\u001f\u007f]+(?<!\/)(?<!\.lock)$/;

/** Top-level message only (used for classification). With `withDetail`, also appends GitHub's `errors[]` text (for display). */
function parseMessage(text: string, withDetail = false): string {
  try {
    const body = JSON.parse(text) as { message?: unknown; errors?: unknown };
    let msg = typeof body.message === 'string' ? body.message : text.slice(0, 200);
    // GitHub validation errors (422) keep the useful detail in `errors[]`, e.g. "name already exists on this account".
    if (withDetail && Array.isArray(body.errors)) {
      const detail = body.errors
        .map((e: unknown) => {
          if (typeof e === 'string') return e;
          const o = (e ?? {}) as Record<string, unknown>;
          return typeof o.message === 'string' ? o.message : [o.resource, o.field, o.code].filter((x) => typeof x === 'string').join(' ');
        })
        .filter(Boolean)
        .slice(0, 3)
        .join('; ');
      if (detail) msg += ` (${detail})`;
    }
    return msg;
  } catch {
    return text.slice(0, 200);
  }
}

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly maxRateLimitWaitMs: number;
  /** Shared by every request: once GitHub says wait, all concurrent workers wait. */
  private pauseUntil = 0;

  constructor(o: ClientOptions) {
    this.token = o.token;
    this.fetchImpl = o.fetchImpl ?? ((...a) => fetch(...a));
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    this.baseUrl = o.baseUrl ?? 'https://api.github.com';
    this.maxRetries = o.maxRetries ?? 3;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.maxRateLimitWaitMs = o.maxRateLimitWaitMs ?? 60_000;
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(this.random() * 250);
  }

  private classify(status: number, headers: Headers, text: string): { error: EngineError; waitMs?: number } {
    const msg = parseMessage(text); // classification must not see the errors[] detail
    const shown = parseMessage(text, true);
    if (status === 401) {
      return { error: new EngineError('AUTH', 'GitHub rejected the access token (expired or revoked).', {
        status, hint: 'Reconnect your GitHub account and try again.' }) };
    }
    if (status === 403 || status === 429) {
      const remaining = headers.get('x-ratelimit-remaining');
      const retryAfter = Number(headers.get('retry-after'));
      const reset = Number(headers.get('x-ratelimit-reset'));
      const limited = status === 429 || remaining === '0' || headers.has('retry-after') || /rate limit|abuse/i.test(msg);
      if (limited) {
        const waitMs = retryAfter > 0 ? retryAfter * 1000
          : remaining === '0' && reset > 0 ? Math.max(0, reset * 1000 - this.now()) + 1000
          : 60_000;
        const resetAt = this.now() + waitMs;
        return {
          waitMs,
          error: new EngineError('RATE_LIMIT', 'GitHub API rate limit reached.', {
            status, resetAt, recoverable: waitMs <= this.maxRateLimitWaitMs,
            hint: `Wait until ${new Date(resetAt).toISOString()} and retry; nothing was committed.`,
          }),
        };
      }
      return { error: new EngineError('PERMISSION', `GitHub denied access: ${shown}`, {
        status, hint: 'Make sure the app is authorised for this repository and has write access to repository contents. Organisation repos may need an admin to approve the app.' }) };
    }
    if (status === 404) {
      return { error: new EngineError('NOT_FOUND', 'Repository, branch or object not found.', {
        status, hint: 'Check the owner, repository and branch names. GitHub also returns 404 for private repositories your token cannot access.' }) };
    }
    if (status === 409 || (status === 422 && /fast.?forward|already exists/i.test(msg))) {
      return { error: new EngineError('CONFLICT', `Conflict while updating the branch: ${shown}`, {
        status, hint: 'The branch changed during deployment. Re-run the deployment to rebase onto the latest commit.' }) };
    }
    if (status >= 500) {
      return { error: new EngineError('GITHUB_API', `GitHub server error (${status}).`, {
        status, recoverable: true, hint: 'GitHub is having trouble. Retry in a minute.' }) };
    }
    return { error: new EngineError('GITHUB_API', `GitHub rejected the request (${status}): ${shown}`, { status }) };
  }

  /** Large uploads get extra time, assuming at least ~50 KB/s of upstream bandwidth. */
  requestTimeoutMs(bodyBytes = 0): number {
    return this.timeoutMs + Math.ceil(bodyBytes / 50);
  }

  async request<T>(method: string, path: string, opts: ReqOptions = {}): Promise<T> {
    const bodyInit = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const timeoutMs = this.requestTimeoutMs(opts.rawBody?.size ?? (typeof bodyInit === 'string' ? bodyInit.length : 0));
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw cancelled();
      const pause = this.pauseUntil - this.now();
      if (pause > 0) await this.sleep(pause, opts.signal);
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
      let out: { ok: boolean; status: number; headers: Headers; text: string };
      try {
        const res = await this.fetchImpl(this.baseUrl + path, {
          method,
          signal: ctl.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(bodyInit !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: bodyInit,
        });
        out = { ok: res.ok, status: res.status, headers: res.headers, text: await res.text() };
      } catch (e) {
        if (opts.signal?.aborted) throw cancelled();
        const err = timedOut
          ? new EngineError('TIMEOUT', `GitHub did not respond within ${Math.round(timeoutMs / 1000)}s.`, { recoverable: true, hint: 'Check your connection and retry.', cause: e })
          : new EngineError('NETWORK', 'Network error while contacting GitHub.', { recoverable: true, hint: 'Check your internet connection and retry.', cause: e });
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(this.backoff(attempt), opts.signal);
        continue;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      if (out.ok) return (out.text ? JSON.parse(out.text) : undefined) as T;
      const { error, waitMs } = this.classify(out.status, out.headers, out.text);
      if (error.code === 'RATE_LIMIT' && error.recoverable) {
        this.pauseUntil = Math.max(this.pauseUntil, this.now() + (waitMs ?? 0));
        if (attempt < this.maxRetries) continue; // the pause above is honoured at the top of the loop
      } else if (error.recoverable && attempt < this.maxRetries) {
        await this.sleep(waitMs ?? this.backoff(attempt), opts.signal);
        continue;
      }
      throw error;
    }
  }

  private repo(owner: string, repo: string): string {
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
      throw new EngineError('INVALID_PATH', `Invalid repository "${owner}/${repo}".`, { hint: 'Use the exact owner and repository name.' });
    }
    return `/repos/${owner}/${repo}`;
  }

  private branchPath(branch: string): string {
    if (!REF_RE.test(branch)) {
      throw new EngineError('INVALID_PATH', `Invalid branch name "${branch}".`, { hint: 'Branch names cannot contain spaces, "..", "~", "^", ":", "?", "*", "[" or "\\".' });
    }
    return branch.split('/').map(encodeURIComponent).join('/');
  }

  async getBranch(owner: string, repo: string, branch: string, signal?: AbortSignal): Promise<BranchHead> {
    const base = this.repo(owner, repo);
    const ref = await this.request<{ object: { sha: string } }>('GET', `${base}/git/ref/heads/${this.branchPath(branch)}`, { signal });
    const commit = await this.request<{ tree: { sha: string } }>('GET', `${base}/git/commits/${ref.object.sha}`, { signal });
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async getTree(owner: string, repo: string, treeSha: string, signal?: AbortSignal): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const r = await this.request<{ tree: TreeEntry[]; truncated: boolean }>('GET', `${this.repo(owner, repo)}/git/trees/${treeSha}?recursive=1`, { signal });
    return { entries: r.tree, truncated: r.truncated };
  }

  async createBlob(owner: string, repo: string, data: Uint8Array, signal?: AbortSignal): Promise<string> {
    // Built as bytes (prefix + base64 + suffix) so no giant string or JSON.stringify copy is created.
    const rawBody = new Blob([BLOB_PREFIX, encodeBase64Bytes(data), BLOB_SUFFIX], { type: 'application/json' });
    const r = await this.request<{ sha: string }>('POST', `${this.repo(owner, repo)}/git/blobs`, { rawBody, signal });
    return r.sha;
  }

  async createTree(owner: string, repo: string, p: { baseTree: string; tree: NewTreeEntry[] }, signal?: AbortSignal): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repo(owner, repo)}/git/trees`, { body: { base_tree: p.baseTree, tree: p.tree }, signal });
    return r.sha;
  }

  async createCommit(owner: string, repo: string, p: { message: string; tree: string; parents: string[] }, signal?: AbortSignal): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repo(owner, repo)}/git/commits`, { body: p, signal });
    return r.sha;
  }

  /** Never forces: a non-fast-forward update surfaces as CONFLICT instead of overwriting others' work. */
  async updateRef(owner: string, repo: string, branch: string, sha: string, signal?: AbortSignal): Promise<void> {
    await this.request('PATCH', `${this.repo(owner, repo)}/git/refs/heads/${this.branchPath(branch)}`, { body: { sha, force: false }, signal });
  }

  async createRef(owner: string, repo: string, branch: string, sha: string, signal?: AbortSignal): Promise<void> {
    this.branchPath(branch);
    await this.request('POST', `${this.repo(owner, repo)}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha }, signal });
  }
}
