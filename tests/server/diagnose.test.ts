import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnoseReport } from '../../src/types/diagnose';
import { makeHarness } from './harness';

const R = (id: number, name: string, owner: string, priv: boolean) => ({
  id, name, full_name: `${owner}/${name}`, owner: { login: owner }, private: priv, description: null, default_branch: 'main', html_url: `https://github.com/${owner}/${name}`,
  permissions: { admin: true, push: true, pull: true }, archived: false, fork: false, pushed_at: '2026-10-01T00:00:00Z',
});
/** Mirrors the reported account: ericsahne with a public repo, the private zipora-eric, and an organization repo. */
const MINE = [R(1, 'blog', 'ericsahne', false), R(2, 'zipora-eric', 'ericsahne', true), R(3, 'my.repo', 'acme', true)];
const base = { login: 'ericsahne', repos: MINE, enforceAccess: true };
const diag = async (h: Awaited<ReturnType<typeof makeHarness>>, repo = 'ericsahne/zipora-eric') => (await (await h.call(`/api/auth/diagnose?repo=${encodeURIComponent(repo)}`)).json()) as DiagnoseReport;
const codes = (r: DiagnoseReport) => r.diagnosis.map((d) => d.code);

afterEach(() => vi.restoreAllMocks());

describe('GitHub access diagnostics', () => {
  it('healthy OAuth App token: verifies the user, lists public AND private repositories, checks the private repo — all with the SAME token', async () => {
    const h = await makeHarness({ oauth: base });
    await h.signIn();
    const r = await diag(h);
    expect(r.token).toMatchObject({ kind: 'oauth-app', sameTokenForAllCalls: true });
    expect(r.user).toMatchObject({ status: 200, login: 'ericsahne', matchesSession: true, grantedScopes: ['repo'] });
    expect(r.repos).toMatchObject({ status: 200, count: 3, publicCount: 1, privateCount: 2 });
    expect(r.repoCheck).toMatchObject({ name: 'ericsahne/zipora-eric', status: 200, private: true, canPush: true, branches: { status: 200, count: 1 } });
    expect(codes(r)).toEqual(['ALL_CHECKS_PASSED']);

    const upstream = h.oauth.log.filter((l) => l.host === 'api.github.com' && !l.path.startsWith('/applications'));
    expect(new Set(upstream.map((l) => l.headers.authorization)).size).toBe(1); // one token for /user, /user/repos, /repos/…
    expect(upstream[0].headers.authorization).toBe(`Bearer ${h.oauth.state.issued[0]}`);
    const list = upstream.find((l) => l.path === '/user/repos')!;
    expect(list.search).toContain('visibility=all');
    expect(list.search).toContain('affiliation=owner,collaborator,organization_member');
    expect(list.search).toContain('per_page=100');
  });

  it('never returns the token, the client secret, the session secret or cookies', async () => {
    const h = await makeHarness({ oauth: base });
    await h.signIn();
    const text = JSON.stringify(await diag(h));
    for (const secret of [h.oauth.state.issued[0], h.config.clientSecret, h.config.secrets[0], h.jar.cookies.get('__Host-zipora_session') ?? 'x']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{10}/);
  });

  it('GitHub App user token on an app that is not installed: reproduces "login works, zero repositories, private repo NOT_FOUND" and explains it', async () => {
    const h = await makeHarness({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { ...base, tokenPrefix: 'ghu', grantedScope: '', appInstalledOn: [] } });
    await h.signIn();
    const r = await diag(h);
    expect(r.token.kind).toBe('github-app-user');
    expect(r.user).toMatchObject({ status: 200, login: 'ericsahne', grantedScopes: null }); // GitHub App tokens carry no X-OAuth-Scopes
    expect(r.repos).toMatchObject({ status: 200, count: 0 });
    expect(r.repoCheck).toMatchObject({ status: 404 });
    expect(r.installations).toMatchObject({ status: 200, count: 0 });
    expect(codes(r)).toEqual(expect.arrayContaining(['GITHUB_APP_TOKEN', 'EMPTY_REPO_LIST', 'REPO_NOT_VISIBLE']));
    expect(r.diagnosis.find((d) => d.code === 'GITHUB_APP_TOKEN')!.message).toMatch(/OAuth App/);
    expect(r.diagnosis.find((d) => d.code === 'GITHUB_APP_TOKEN')!.severity).toBe('error');
  });

  it('GitHub App token that IS installed sees the repository (warning only)', async () => {
    const h = await makeHarness({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { ...base, tokenPrefix: 'ghu', grantedScope: '', appInstalledOn: ['ericsahne/zipora-eric'] } });
    await h.signIn();
    const r = await diag(h);
    expect(r.repos).toMatchObject({ count: 1, privateCount: 1 });
    expect(r.repoCheck).toMatchObject({ status: 200 });
    expect(r.diagnosis.find((d) => d.code === 'GITHUB_APP_TOKEN')!.severity).toBe('warn');
  });

  it('OAuth token WITHOUT the repo scope: private repositories are hidden and GitHub answers 404 for them', async () => {
    const h = await makeHarness({ env: { GITHUB_OAUTH_SCOPE: 'public_repo' }, oauth: { ...base, grantedScope: 'public_repo' } });
    await h.signIn();
    const r = await diag(h);
    expect(r.user.grantedScopes).toEqual(['public_repo']);
    expect(r.repos).toMatchObject({ count: 1, publicCount: 1, privateCount: 0 });
    expect(r.repoCheck).toMatchObject({ status: 404 });
    expect(codes(r)).toEqual(expect.arrayContaining(['PUBLIC_REPO_SCOPE_ONLY', 'REPO_NOT_VISIBLE']));
    expect(r.diagnosis.find((d) => d.code === 'PUBLIC_REPO_SCOPE_ONLY')!.message).toMatch(/GITHUB_OAUTH_SCOPE=repo/);
  });

  it('a revoked token is reported as such, with GitHub\'s own status', async () => {
    const h = await makeHarness({ oauth: base });
    await h.signIn();
    h.oauth.accessTokens.clear();
    const r = await diag(h);
    expect(r.user.status).toBe(401);
    expect(r.repos.status).toBe(401);
    expect(codes(r)).toEqual(expect.arrayContaining(['TOKEN_REJECTED', 'REPO_LIST_FAILED']));
  });

  it('a read-only repository and an unreadable repo name are handled', async () => {
    const h = await makeHarness({ oauth: { ...base, repos: [{ ...R(9, 'ro', 'ericsahne', false), permissions: { admin: false, push: false, pull: true } }] } });
    await h.signIn();
    expect(codes(await diag(h, 'ericsahne/ro'))).toContain('NO_PUSH_ACCESS');
    const before = h.oauth.log.length;
    const r = await diag(h, '../../etc/passwd');
    expect(r.repoCheck).toBeUndefined(); // invalid names are ignored, never forwarded
    expect(h.oauth.log.slice(before).some((l) => l.path.includes('..'))).toBe(false);
  });

  it('requires a session and refuses cross-site requests', async () => {
    const h = await makeHarness({ oauth: base });
    expect((await h.call('/api/auth/diagnose')).status).toBe(401);
    await h.signIn();
    expect((await h.call('/api/auth/diagnose', { site: 'cross-site' })).status).toBe(403);
    expect((await h.call('/api/auth/diagnose', { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('listing through the authenticated proxy', () => {
  it('returns public and private repositories for visibility=all with the exact query the app sends', async () => {
    const h = await makeHarness({ oauth: base });
    await h.signIn();
    const res = await h.call('/api/github/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=1&sort=updated');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ full_name: string; private: boolean }>;
    expect(list.map((r) => `${r.full_name}:${r.private ? 'private' : 'public'}`)).toEqual(['ericsahne/blog:public', 'ericsahne/zipora-eric:private', 'acme/my.repo:private']);
    const sent = h.oauth.log.filter((l) => l.path === '/user/repos').at(-1)!;
    expect(sent.headers.authorization).toBe(`Bearer ${h.oauth.state.issued[0]}`);
    expect(new URLSearchParams(sent.search).get('affiliation')).toBe('owner,collaborator,organization_member');
  });

  it('paginates beyond 100 repositories without losing any', async () => {
    const many = Array.from({ length: 230 }, (_, i) => R(100 + i, `repo-${String(i).padStart(3, '0')}`, 'ericsahne', i % 2 === 0));
    const h = await makeHarness({ oauth: { ...base, repos: many } });
    await h.signIn();
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const arr = (await (await h.call(`/api/github/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`)).json()) as Array<{ name: string }>;
      seen.push(...arr.map((r) => r.name));
    }
    expect(seen).toHaveLength(230);
    expect(new Set(seen).size).toBe(230);
  });
});

describe('safe diagnostic logging', () => {
  it('logs status, GitHub message, user, scopes and repository count — and never a token or secret', async () => {
    const lines: string[] = [];
    for (const m of ['info', 'log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const h = await makeHarness({ oauth: base });
    await h.signIn();                                                             // sign-in line
    await h.call('/api/github/user/repos?visibility=all&per_page=100');            // proxied listing line
    await h.call('/api/github/repos/ericsahne/not-mine');                          // an upstream 404 line (GitHub's message)
    await diag(h);                                                                 // diagnose line
    const all = lines.join('\n');
    expect(all).toMatch(/\[zipora\] sign-in .*"login":"ericsahne".*"tokenKind":"oauth-app".*"grantedScope":"repo"/);
    expect(all).toMatch(/\[zipora\] github .*"req":"GET \/user\/repos".*"status":200.*"user":"ericsahne".*"scopes":"repo".*"repos":3/);
    expect(all).toMatch(/\[zipora\] github .*"status":404.*"message":"Not Found"/);
    expect(all).toMatch(/\[zipora\] diagnose .*"login":"ericsahne".*"repos":3.*"public":1.*"private":2/);
    for (const secret of [h.oauth.state.issued[0], h.config.clientSecret, h.config.secrets[0], h.jar.cookies.get('__Host-zipora_session') ?? 'x']) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/gh[pousr]_[A-Za-z0-9]{10}/);
  });
});
