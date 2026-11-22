// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { parseRepo } from '../../src/services/github';
import { SITE, repo, setup, zipFile } from './helpers';

const R = (id: number, name: string, owner: string, priv: boolean) => repo(id, name, { owner: { login: owner }, full_name: `${owner}/${name}`, private: priv, html_url: `https://github.com/${owner}/${name}`, description: `${name} repo` });
const MINE = [R(1, 'blog', 'ericsahne', false), R(2, 'zipora-eric', 'ericsahne', true), R(3, 'my.repo', 'acme', true)];
const base = { login: 'ericsahne', repos: MINE, enforceAccess: true };
const u = () => userEvent.setup();

async function toRepositoryStep(opts: Parameters<typeof setup>[0] = {}) {
  const ctx = await setup({ route: '/new', ...opts, oauth: { ...base, ...opts.oauth } });
  const user = u();
  await user.upload(await screen.findByTestId('zip-input'), await zipFile(SITE));
  await user.click(await screen.findByRole('link', { name: /Continue to repository/ }));
  await screen.findByRole('heading', { name: 'Choose a destination' });
  return { ...ctx, user };
}
const upstream = (h: Awaited<ReturnType<typeof setup>>['h']) => h.oauth.log.filter((l) => l.host === 'api.github.com');

describe('repository listing shows public AND private repositories', () => {
  it('lists every repository with the right visibility badge', async () => {
    await toRepositoryStep();
    const list = await screen.findByRole('list', { name: 'Repositories' });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(within(list).getByRole('button', { name: /ericsahne\/blog/ })).toHaveTextContent('Public');
    expect(within(list).getByRole('button', { name: /ericsahne\/zipora-eric/ })).toHaveTextContent('Private');
    expect(within(list).getByRole('button', { name: /acme\/my\.repo/ })).toHaveTextContent('Private');
    expect(screen.queryByText('GitHub returned no repositories for your account')).not.toBeInTheDocument();
  });

  it('asks GitHub for visibility=all with all affiliations, 100 per page, using the signed-in user\'s token', async () => {
    const { h } = await toRepositoryStep();
    await screen.findByRole('list', { name: 'Repositories' });
    const call = upstream(h).find((l) => l.path === '/user/repos')!;
    const q = new URLSearchParams(call.search);
    expect(q.get('visibility')).toBe('all');
    expect(q.get('affiliation')).toBe('owner,collaborator,organization_member');
    expect(q.get('per_page')).toBe('100');
    expect(call.headers.authorization).toBe(`Bearer ${h.oauth.state.issued[0]}`);
  });
});

describe('deployment targets exactly the selected repository, owner and branch', () => {
  it('deploys to the PRIVATE repository ericsahne/zipora-eric on main', async () => {
    const { h, user } = await toRepositoryStep();
    await user.click(await screen.findByRole('button', { name: /ericsahne\/zipora-eric/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('main'));
    await user.click(screen.getByRole('link', { name: /Continue to review/ }));
    expect(await screen.findByText('ericsahne/zipora-eric')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Deploy to main/ }));
    expect(await screen.findByRole('heading', { name: 'Deployment complete' })).toBeInTheDocument();

    const repoCalls = upstream(h).filter((l) => l.path.startsWith('/repos/'));
    expect(repoCalls.length).toBeGreaterThan(8);
    for (const c of repoCalls) expect(c.path, `${c.method} ${c.path}`).toMatch(/^\/repos\/ericsahne\/zipora-eric\//); // never another owner/name
    expect(repoCalls.some((c) => c.method === 'GET' && c.path === '/repos/ericsahne/zipora-eric/git/ref/heads/main')).toBe(true);
    expect(repoCalls.some((c) => c.method === 'PATCH' && c.path === '/repos/ericsahne/zipora-eric/git/refs/heads/main')).toBe(true);
    expect(h.oauth.git.count('POST', '/git/commits')).toBe(1);
    expect(JSON.parse(localStorage.getItem('zipora:v1:history:4242')!)[0]).toMatchObject({ owner: 'ericsahne', repo: 'zipora-eric', branch: 'main', status: 'success' });
  });

  it('deploys an ORGANIZATION repo with a dot in its name to a new branch containing a slash', async () => {
    const { h, user } = await toRepositoryStep();
    await user.click(await screen.findByRole('button', { name: /acme\/my\.repo/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('main'));
    await user.click(screen.getByRole('button', { name: /New branch/ }));
    const form = screen.getByRole('form', { name: 'Create branch' });
    await user.type(within(form).getByLabelText('New branch name'), 'release/v1');
    await user.click(within(form).getByRole('button', { name: 'Create branch' }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('release/v1'));
    expect(upstream(h).some((l) => l.method === 'POST' && l.path === '/repos/acme/my.repo/git/refs')).toBe(true); // branch created on acme/my.repo, not on the user's repos

    await user.click(screen.getByRole('link', { name: /Continue to review/ }));
    await user.click(await screen.findByRole('button', { name: /Deploy to release\/v1/ }));
    expect(await screen.findByRole('heading', { name: 'Deployment complete' })).toBeInTheDocument();

    const calls = upstream(h).filter((l) => l.path.startsWith('/repos/'));
    for (const c of calls) expect(c.path).toMatch(/^\/repos\/acme\/my\.repo\//);
    expect(calls.some((c) => c.method === 'GET' && c.path === '/repos/acme/my.repo/git/ref/heads/release/v1')).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/repos/acme/my.repo/git/refs/heads/release/v1')).toBe(true);
    expect(calls.some((c) => c.path.includes('ericsahne'))).toBe(false);
  });

  it('switching repositories resets the branch so a stale branch is never deployed to the new repository', async () => {
    const { user } = await toRepositoryStep();
    await user.click(await screen.findByRole('button', { name: /ericsahne\/blog/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('main'));
    await user.click(screen.getByRole('button', { name: /New branch/ }));
    const form = screen.getByRole('form', { name: 'Create branch' });
    await user.type(within(form).getByLabelText('New branch name'), 'only-on-blog');
    await user.click(within(form).getByRole('button', { name: 'Create branch' }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('only-on-blog'));
    await user.click(screen.getByRole('button', { name: /acme\/my\.repo/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).not.toHaveValue('only-on-blog'));
  });
});

describe('an empty or incomplete list is explained, never presented as normal', () => {
  it('GitHub App token: shows a warning and runs diagnostics that name the real cause (no mock repositories)', async () => {
    const { h } = await toRepositoryStep({ env: { GITHUB_OAUTH_SCOPE: 'none' }, oauth: { tokenPrefix: 'ghu', grantedScope: '', appInstalledOn: [] } });
    expect(await screen.findByText('GitHub returned no repositories for your account')).toBeInTheDocument();
    expect(screen.queryByText('No repositories found')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Repositories' })).not.toBeInTheDocument(); // nothing invented
    const panel = await screen.findByRole('region', { name: 'GitHub access diagnostics' });
    expect(await within(panel).findByText('GITHUB_APP_TOKEN')).toBeInTheDocument();
    expect(within(panel).getByText('EMPTY_REPO_LIST')).toBeInTheDocument();
    expect(within(panel).getByText(/@ericsahne/, { selector: 'dd' })).toHaveTextContent('matches your session');
    expect(within(panel).getByText('GitHub App user token (ghu_…)')).toBeInTheDocument();
    expect(within(panel).getByText('not reported by GitHub')).toBeInTheDocument();
    expect(within(panel).getByText(/Same token for every check/).nextSibling).toHaveTextContent('Yes');
    expect(JSON.stringify(h.oauth.log.map((l) => l.path))).toContain('/user/installations');
  });

  it('OAuth token without the repo scope: public repos listed, and diagnostics explain what is hidden', async () => {
    const { user } = await toRepositoryStep({ env: { GITHUB_OAUTH_SCOPE: 'public_repo' }, oauth: { grantedScope: 'public_repo' } });
    const list = await screen.findByRole('list', { name: 'Repositories' });
    expect(within(list).getAllByRole('button')).toHaveLength(1); // only the public one
    await user.click(screen.getByRole('button', { name: 'Not seeing your repositories?' }));
    await user.click(await screen.findByRole('button', { name: 'Run diagnostics' }));
    const panel = screen.getByRole('region', { name: 'GitHub access diagnostics' });
    expect(await within(panel).findByText('PUBLIC_REPO_SCOPE_ONLY')).toBeInTheDocument();
    expect(within(panel).getByText('public_repo')).toBeInTheDocument();
  });

  it('a NOT_FOUND during deployment offers diagnostics for that repository', async () => {
    const { h, user } = await toRepositoryStep();
    await user.click(await screen.findByRole('button', { name: /ericsahne\/zipora-eric/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch', { exact: true })).toHaveValue('main'));
    await user.click(screen.getByRole('link', { name: /Continue to review/ }));
    h.oauth.git.onRequest = (m, p) => (m === 'GET' && p.startsWith('/git/ref/heads/') ? new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }) : undefined);
    await user.click(await screen.findByRole('button', { name: /Deploy to main/ }));
    expect(await screen.findByText('Not found')).toBeInTheDocument();
    const panel = await screen.findByRole('region', { name: 'GitHub access diagnostics' });
    expect(panel).toHaveTextContent('ericsahne/zipora-eric');
    await user.click(within(panel).getByRole('button', { name: 'Run diagnostics' }));
    expect((await within(panel).findAllByText(/HTTP 200/, { selector: 'dd' })).length).toBeGreaterThanOrEqual(2); // GET /user and GET /user/repos answered
    await user.click(within(panel).getByRole('button', { name: 'Copy report' }));
  });
});

describe('response parsing tolerates GitHub payload variations', () => {
  it('handles null fields, missing permissions, organization owners and extra properties', () => {
    expect(parseRepo({ id: 1, name: 'x', full_name: 'acme/x', owner: { login: 'acme', type: 'Organization', id: 5 }, private: true, description: null, default_branch: 'trunk', pushed_at: null, updated_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/acme/x', somethingNew: { a: 1 } }))
      .toMatchObject({ owner: 'acme', name: 'x', fullName: 'acme/x', private: true, description: null, defaultBranch: 'trunk', updatedAt: '2026-01-01T00:00:00Z', canPush: true });
    expect(parseRepo({ id: 2, name: 'y', owner: { login: 'o' }, permissions: { admin: false, push: false, pull: true } })!.canPush).toBe(false);
    expect(parseRepo({ id: 3, name: 'z', owner: { login: 'o' }, private: 'yes' })!.private).toBe(false); // only a real boolean true means private
  });
});
