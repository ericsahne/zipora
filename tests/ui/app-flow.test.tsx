// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SITE, setup, zipFile } from './helpers';

const user = () => userEvent.setup();

describe('landing and authentication', () => {
  it('shows the product and starts the real OAuth flow from the primary CTA', async () => {
    const { redirect } = await setup({ signedIn: false, route: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: /Deploy Anything\.\s*Anywhere\./ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Sign in with GitHub/ })[0]).toBeEnabled());
    await user().click(screen.getAllByRole('button', { name: /Sign in with GitHub/ })[0]);
    expect(redirect).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fdashboard');
  });

  it('explains OAuth failures from the callback redirect', async () => {
    await setup({ signedIn: false, route: '/?auth_error=ACCESS_DENIED' });
    expect(await screen.findByText('Authorization was cancelled')).toBeInTheDocument();
  });

  it('sends signed-out visitors away from protected pages and remembers where they wanted to go', async () => {
    const { redirect } = await setup({ signedIn: false, route: '/new/workspace' });
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Sign in with GitHub/ })[0]).toBeEnabled());
    await user().click(screen.getAllByRole('button', { name: /Sign in with GitHub/ })[0]);
    expect(redirect).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fnew%2Fworkspace');
  });

  it('signed-in landing offers the dashboard instead of sign-in', async () => {
    await setup({ route: '/' });
    expect(await screen.findByRole('link', { name: /Open dashboard/ })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('@octo-dev')).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('shows the connected account and honest empty states (no invented statistics)', async () => {
    const { container } = await setup();
    expect(await screen.findByRole('heading', { name: 'Welcome, Octo Dev' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@octo-dev' })).toHaveAttribute('href', 'https://github.com/octo-dev');
    expect([...container.querySelectorAll('[data-stat-value]')].map((e) => e.textContent)).toEqual(['0', '0', '0']);
    expect(screen.getByText('No deployments yet')).toBeInTheDocument();
    expect(screen.getByText(/Repositories will appear here after your first deployment/)).toBeInTheDocument();
  });
});

describe('ZIP upload with the real engine', () => {
  it('validates, extracts and previews an archive; lets you remove and replace it', async () => {
    const u = user();
    await setup({ route: '/new' });
    const input = await screen.findByTestId('zip-input');
    await u.upload(input, await zipFile(SITE));
    expect(await screen.findByRole('tree', { name: 'Archive contents' })).toBeInTheDocument();
    expect(screen.getByText('3 files')).toBeInTheDocument();
    expect(screen.getByText('site.zip')).toBeInTheDocument();
    await u.click(screen.getByRole('treeitem', { name: /assets/ }));
    await u.click(screen.getByRole('treeitem', { name: /app\.js/ }));
    expect(await screen.findByLabelText('File preview')).toHaveTextContent('console.log(1)');
    expect(screen.getByRole('link', { name: /Continue to repository/ })).toBeEnabled();

    await u.click(screen.getByRole('button', { name: /Remove/ }));
    expect(await screen.findByText('Drag and drop a ZIP file here')).toBeInTheDocument();

    await u.upload(screen.getByTestId('zip-input'), await zipFile({ 'only.txt': 'x' }, 'second.zip'));
    expect(await screen.findByText('second.zip')).toBeInTheDocument();
    await u.upload(screen.getByLabelText('Replace the archive'), await zipFile({ 'a.txt': '1', 'b.txt': '2' }, 'third.zip'));
    expect(await screen.findByText('third.zip')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
  });

  it('rejects a file that is not a ZIP with a clear, actionable error', async () => {
    await setup({ route: '/new' });
    const bad = new File(['this is not a zip'], 'notes.zip', { type: 'application/zip' });
    await user().upload(await screen.findByTestId('zip-input'), bad);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not a valid ZIP archive');
    expect(alert).toHaveTextContent('INVALID_ZIP');
    expect(screen.getByText('Drag and drop a ZIP file here')).toBeInTheDocument();
  });

  it('shows validation errors for a dangerous archive and blocks continuing', async () => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    z.file('A.txt', '1'); z.file('a.txt', '2'); z.file('ok.txt', '3');
    const file = new File([new Uint8Array(await z.generateAsync({ type: 'uint8array' }))], 'clash.zip', { type: 'application/zip' });
    await setup({ route: '/new' });
    await user().upload(await screen.findByTestId('zip-input'), file);
    expect(await screen.findByText('This archive cannot be deployed as it is')).toBeInTheDocument();
    expect(screen.getByText('CASE_COLLISION')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to repository/ })).toBeDisabled();
  });
});

describe('repository selection with real GitHub API responses (via the authenticated proxy)', () => {
  async function toRepositoryStep() {
    const ctx = await setup({ route: '/new' });
    const u = user();
    await u.upload(await screen.findByTestId('zip-input'), await zipFile(SITE));
    await u.click(await screen.findByRole('link', { name: /Continue to repository/ }));
    await screen.findByRole('heading', { name: 'Choose a destination' });
    return { ...ctx, u };
  }

  it('lists repositories with visibility badges, searches, and flags unusable ones', async () => {
    const { u } = await toRepositoryStep();
    const list = await screen.findByRole('list', { name: 'Repositories' });
    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(within(list).getByRole('button', { name: /octo-dev\/notes/ })).toHaveTextContent('Private');
    expect(within(list).getByRole('button', { name: /octo-dev\/site/ })).toHaveTextContent('Public');
    expect(within(list).getByRole('button', { name: /readonly/ })).toHaveTextContent('No push access');
    expect(within(list).getByRole('button', { name: /frozen/ })).toHaveTextContent('Archived');
    await u.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'note');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    await u.clear(screen.getByRole('searchbox', { name: 'Search repositories' }));
    await u.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'nothing-like-this');
    expect(await screen.findByText('No repositories match')).toBeInTheDocument();
  });

  it('shows details, loads branches, preselects the default branch, and blocks read-only repositories', async () => {
    const { u } = await toRepositoryStep();
    await u.click(await screen.findByRole('button', { name: /octo-dev\/readonly/ }));
    expect(await screen.findByText('No push access', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to review/ })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: /octo-dev\/site/ }));
    const branch = await screen.findByLabelText('Branch');
    await waitFor(() => expect(branch).toHaveValue('main'));
    expect(screen.getByRole('link', { name: /View on GitHub/ })).toHaveAttribute('href', 'https://github.com/octo-dev/site');
    expect(screen.getByRole('link', { name: /Continue to review/ })).toBeEnabled();
  });

  it('creates a real branch on GitHub and selects it', async () => {
    const { u, h } = await toRepositoryStep();
    await u.click(await screen.findByRole('button', { name: /octo-dev\/site/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('main'));
    await u.click(screen.getByRole('button', { name: /New branch/ }));
    const form = screen.getByRole('form', { name: 'Create branch' });
    await u.type(within(form).getByLabelText('New branch name'), 'bad name');
    await u.click(within(form).getByRole('button', { name: 'Create branch' }));
    expect(await within(form).findByText(/characters Git does not allow/)).toBeInTheDocument();
    await u.clear(within(form).getByLabelText('New branch name'));
    await u.type(within(form).getByLabelText('New branch name'), 'feature/zip-drop');
    await u.click(within(form).getByRole('button', { name: 'Create branch' }));
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('feature/zip-drop'));
    expect(h.oauth.git.branches()).toContain('feature/zip-drop');
    expect(h.oauth.git.head('feature/zip-drop')).toBe(h.oauth.git.head('main'));
  });

  it('creates a real repository (validating the name first) and selects it', async () => {
    const { u, h } = await toRepositoryStep();
    await u.click(await screen.findByRole('button', { name: 'New' }));
    const form = screen.getByRole('form', { name: 'Create repository' });
    await within(form).findByRole('option', { name: 'acme' });
    await u.type(within(form).getByLabelText('Repository name'), 'bad name!');
    await u.click(within(form).getByRole('button', { name: 'Create repository' }));
    expect(await within(form).findByText(/Use only letters/)).toBeInTheDocument();
    expect(h.oauth.repos).toHaveLength(4);
    await u.clear(within(form).getByLabelText('Repository name'));
    await u.type(within(form).getByLabelText('Repository name'), 'fresh-repo');
    await u.click(within(form).getByLabelText('Public'));
    await u.click(within(form).getByRole('button', { name: 'Create repository' }));
    expect(await screen.findByText('octo-dev/fresh-repo', { selector: 'p' })).toBeInTheDocument();
    expect(h.oauth.repos[0]).toMatchObject({ name: 'fresh-repo', private: false });
    expect(screen.queryByRole('form', { name: 'Create repository' })).not.toBeInTheDocument();
  });

  it('reports a GitHub error (name already exists) with details', async () => {
    const { u } = await toRepositoryStep();
    await u.click(await screen.findByRole('button', { name: 'New' }));
    const form = screen.getByRole('form', { name: 'Create repository' });
    await u.type(within(form).getByLabelText('Repository name'), 'site');
    await u.click(within(form).getByRole('button', { name: 'Create repository' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('(422)'); // GitHub's real validation error, not a proxy/transport failure
    expect(alert).toHaveTextContent('name already exists');
  });
});

describe('deployment workspace: real engine, real proxy, no simulation', () => {
  async function toWorkspace(oauthOver: Parameters<typeof setup>[0] = {}) {
    const ctx = await setup({ route: '/new', ...oauthOver });
    const u = user();
    await u.upload(await screen.findByTestId('zip-input'), await zipFile(SITE));
    await u.click(await screen.findByRole('link', { name: /Continue to repository/ }));
    await u.click(await screen.findByRole('button', { name: /octo-dev\/site/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('main'));
    await u.click(screen.getByRole('link', { name: /Continue to review/ }));
    await screen.findByRole('heading', { name: 'Review and deploy' });
    return { ...ctx, u };
  }

  it('previews the diff against the live branch, then deploys one real commit and records it', async () => {
    const { u, h } = await toWorkspace();
    expect(screen.getByText('octo-dev/site')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Preview changes/ }));
    const preview = await screen.findByLabelText('Preview result');
    expect(preview).toHaveTextContent('2 new files');
    expect(preview).toHaveTextContent('1 changed file');
    expect(h.oauth.git.count('POST', '/git/commits')).toBe(0); // preview writes nothing

    const message = screen.getByLabelText('Commit message');
    await u.clear(message);
    await u.type(message, 'Ship it');
    await u.click(screen.getByRole('button', { name: /Deploy to main/ }));

    expect(await screen.findByText('Deployment complete')).toBeInTheDocument();
    expect(h.oauth.git.files()).toEqual({ 'README.md': 'new readme', 'index.html': '<h1>hi</h1>', 'assets/app.js': 'console.log(1)' });
    expect(h.oauth.git.count('POST', '/git/commits')).toBe(1);
    const link = screen.getByRole('link', { name: /View commit on GitHub/ });
    expect(link.getAttribute('href')).toBe(`https://github.com/octo-dev/site/commit/${h.oauth.git.head()}`);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByLabelText('Deployment progress')).toHaveAttribute('value', '100');

    // GitHub only ever saw the real token, attached by the server; the page never did.
    const token = h.oauth.state.issued[0];
    expect(h.oauth.log.filter((l) => l.path.startsWith('/repos/')).every((l) => l.headers.authorization === `Bearer ${token}`)).toBe(true);
    expect(document.body.innerHTML).not.toContain(token);
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);

    const stored = JSON.parse(localStorage.getItem('zipora:v1:history:4242')!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'success', owner: 'octo-dev', repo: 'site', branch: 'main', message: 'Ship it', fileCount: 3 });
  });

  it('surfaces a real failure from GitHub, creates no commit, and records the failure', async () => {
    const { u, h } = await toWorkspace();
    h.oauth.git.onRequest = (m, p) => (m === 'POST' && p === '/git/blobs' ? new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }) : undefined);
    await u.click(screen.getByRole('button', { name: /Deploy to main/ }));
    const alert = await screen.findByText('Permission denied');
    expect(alert.closest('[role=alert]')).toHaveTextContent('PERMISSION');
    expect(screen.queryByText('Deployment complete')).not.toBeInTheDocument();
    expect(h.oauth.git.count('POST', '/git/commits')).toBe(0);
    expect(h.oauth.git.files()).toEqual({ 'README.md': 'hello' });
    expect(JSON.parse(localStorage.getItem('zipora:v1:history:4242')!)[0]).toMatchObject({ status: 'failed', error: { code: 'PERMISSION' } });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('refuses invalid configuration before anything is sent, and warns loudly about deletions', async () => {
    const { u, h } = await toWorkspace();
    await u.type(screen.getByLabelText('Target directory'), '../escape');
    expect(await screen.findByText(/Target directory/, { selector: 'p.text-danger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Deploy to main/ })).toBeDisabled();
    await u.clear(screen.getByLabelText('Target directory'));
    await u.type(screen.getByLabelText('Target directory'), 'docs/site');
    expect(screen.getByRole('button', { name: /Deploy to main/ })).toBeEnabled();
    await u.click(screen.getByLabelText(/Delete files that are not in the archive/));
    expect(screen.getByText('Deletions are included in the commit')).toBeInTheDocument();
    expect(h.oauth.git.count('POST', '/git/blobs')).toBe(0);
  });

  it('deploys into a target directory without touching other files', async () => {
    const { u, h } = await toWorkspace();
    await u.type(screen.getByLabelText('Target directory'), 'docs/site');
    await u.click(screen.getByRole('button', { name: /Deploy to main/ }));
    expect(await screen.findByText('Deployment complete')).toBeInTheDocument();
    expect(h.oauth.git.files()).toEqual({ 'README.md': 'hello', 'docs/site/index.html': '<h1>hi</h1>', 'docs/site/assets/app.js': 'console.log(1)', 'docs/site/README.md': 'new readme' });
  });

  it('history lists the deployment and its details page shows the commit and logs; the dashboard counts it', async () => {
    const { u, h } = await toWorkspace();
    await u.click(screen.getByRole('button', { name: /Deploy to main/ }));
    await screen.findByText('Deployment complete');
    await u.click(screen.getByRole('link', { name: 'View details' }));
    expect(await screen.findByRole('heading', { name: 'octo-dev/site' })).toBeInTheDocument();
    expect(screen.getByText('Deployed')).toBeInTheDocument();
    expect(screen.getByText(h.oauth.git.head()!)).toBeInTheDocument();
    expect(screen.getByText(/Logs \(\d+\)/)).toBeInTheDocument();
    await u.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'History' }));
    expect(await screen.findByText('Deploy via ZIPORA')).toBeInTheDocument();
    await u.click(screen.getAllByRole('link', { name: 'Dashboard' })[0]);
    expect(await screen.findByText('Recent activity')).toBeInTheDocument();
    expect(screen.queryByText('No deployments yet')).not.toBeInTheDocument();
  });

  it('guards the workspace when no archive or repository has been chosen', async () => {
    await setup({ route: '/new/workspace' });
    expect(await screen.findByText('Nothing to deploy yet')).toBeInTheDocument();
  });
});
