import { EngineError, type GitHubClient } from '../engine';
import type { Branch, Repo } from '../types';

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const enc = encodeURIComponent;

export function parseRepo(raw: unknown): Repo | null {
  const r = raw as Record<string, unknown> | null;
  const owner = (r?.owner as Record<string, unknown> | undefined)?.login;
  if (!r || typeof r.id !== 'number' || typeof r.name !== 'string' || typeof owner !== 'string') return null;
  const perms = r.permissions as Record<string, unknown> | undefined;
  return {
    id: r.id, name: r.name, owner,
    fullName: str(r.full_name, `${owner}/${r.name}`),
    private: r.private === true,
    description: typeof r.description === 'string' ? r.description : null,
    defaultBranch: str(r.default_branch, 'main'),
    htmlUrl: str(r.html_url),
    canPush: perms ? perms.push === true || perms.admin === true : true, // unknown → allow; GitHub will enforce
    archived: r.archived === true,
    fork: r.fork === true,
    updatedAt: str(r.pushed_at) || str(r.updated_at),
  };
}

const unexpected = () => new EngineError('GITHUB_API', 'GitHub returned an unexpected response.', { hint: 'Try again in a moment.' });

/** Pages through the user's repositories (owner, collaborator, organisation member). */
export async function listRepositories(client: GitHubClient, opts: { maxPages?: number; signal?: AbortSignal } = {}): Promise<{ repos: Repo[]; truncated: boolean }> {
  const max = opts.maxPages ?? 5;
  const repos: Repo[] = [];
  for (let page = 1; page <= max; page++) {
    const raw = await client.request<unknown>('GET', `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}&sort=updated`, { signal: opts.signal });
    if (!Array.isArray(raw)) throw unexpected();
    for (const x of raw) { const r = parseRepo(x); if (r) repos.push(r); }
    if (raw.length < 100) return { repos, truncated: false };
  }
  return { repos, truncated: true };
}

export async function listBranches(client: GitHubClient, owner: string, repo: string, signal?: AbortSignal): Promise<Branch[]> {
  const out: Branch[] = [];
  for (let page = 1; page <= 5; page++) {
    const raw = await client.request<unknown>('GET', `/repos/${enc(owner)}/${enc(repo)}/branches?per_page=100&page=${page}`, { signal });
    if (!Array.isArray(raw)) throw unexpected();
    for (const b of raw as Array<Record<string, unknown>>) {
      if (typeof b?.name === 'string') out.push({ name: b.name, sha: str((b.commit as Record<string, unknown> | undefined)?.sha), protected: b.protected === true });
    }
    if (raw.length < 100) break;
  }
  return out;
}

export async function listOrgs(client: GitHubClient, signal?: AbortSignal): Promise<string[]> {
  const raw = await client.request<unknown>('GET', '/user/orgs?per_page=100', { signal });
  if (!Array.isArray(raw)) throw unexpected();
  return (raw as Array<Record<string, unknown>>).map((o) => o.login).filter((l): l is string => typeof l === 'string').sort((a, b) => a.localeCompare(b));
}

export interface NewRepo { org?: string; name: string; description: string; private: boolean }

/** Creates the repository with an initial commit (auto_init) so it has a branch to deploy to. */
export async function createRepository(client: GitHubClient, input: NewRepo): Promise<Repo> {
  const path = input.org ? `/orgs/${enc(input.org)}/repos` : '/user/repos';
  const raw = await client.request<unknown>('POST', path, { body: { name: input.name, description: input.description || undefined, private: input.private, auto_init: true } });
  const repo = parseRepo(raw);
  if (!repo) throw unexpected();
  return repo;
}

/** Creates `name` pointing at the current tip of `from`. */
export async function createBranch(client: GitHubClient, owner: string, repo: string, name: string, from: string): Promise<void> {
  const head = await client.getBranch(owner, repo, from);
  await client.createRef(owner, repo, name, head.commitSha);
}

export function validateRepoName(name: string): string | null {
  if (!name) return 'Enter a repository name.';
  if (name.length > 100) return 'Use 100 characters or fewer.';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'Use only letters, numbers, ".", "-" and "_".';
  if (name === '.' || name === '..' || name.endsWith('.git')) return 'That name is reserved.';
  return null;
}

export function validateBranchName(name: string, existing: readonly string[]): string | null {
  if (!name) return 'Enter a branch name.';
  if (name.length > 200) return 'Use 200 characters or fewer.';
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name) || name.includes('..') || name.includes('@{') || name.includes('//')) return 'This name contains characters Git does not allow.';
  if (name.startsWith('/') || name.endsWith('/') || name.startsWith('-') || name.endsWith('.') || name.endsWith('.lock')) return 'This is not a valid branch name.';
  if (existing.includes(name)) return 'A branch with this name already exists.';
  return null;
}
