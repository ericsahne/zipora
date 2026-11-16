import { deploy, expect, SITE, signIn, test, toWorkspace, uploadZip } from './fixtures';

test.describe('repository selection and deployment (MOCKED GitHub — not a real deployment)', () => {
  test.beforeEach(async ({ page, mock }) => { void mock; await signIn(page); });

  test('lists repositories with badges, searches, and refuses read-only / archived ones', async ({ page }) => {
    await uploadZip(page);
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    const list = page.getByRole('list', { name: 'Repositories' });
    await expect(list.getByRole('button')).toHaveCount(4);
    await expect(list.getByRole('button', { name: /notes/ })).toContainText('Private');
    await page.getByRole('searchbox', { name: 'Search repositories' }).fill('note');
    await expect(list.getByRole('button')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search repositories' }).fill('');
    await list.getByRole('button', { name: /readonly/ }).click();
    await expect(page.getByRole('button', { name: /Continue to review/ })).toBeDisabled();
    await list.getByRole('button', { name: /frozen/ }).click();
    await expect(page.getByText('This repository is archived')).toBeVisible();
  });

  test('creates a branch and a repository through the real proxy', async ({ page, mock }) => {
    await uploadZip(page);
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    await page.getByRole('button', { name: /octo-dev\/site/ }).click();
    await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
    await page.getByRole('button', { name: /New branch/ }).click();
    const bf = page.getByRole('form', { name: 'Create branch' });
    await bf.getByLabel('New branch name').fill('feature/zip drop');
    await bf.getByRole('button', { name: 'Create branch' }).click();
    await expect(bf.getByText(/characters Git does not allow/)).toBeVisible();
    await bf.getByLabel('New branch name').fill('feature/zip-drop');
    await bf.getByRole('button', { name: 'Create branch' }).click();
    await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('feature/zip-drop');
    expect((await mock.state()).branches).toContain('feature/zip-drop');

    await page.getByRole('button', { name: 'New', exact: true }).click();
    const rf = page.getByRole('form', { name: 'Create repository' });
    await rf.getByLabel('Repository name').fill('bad name!');
    await rf.getByRole('button', { name: 'Create repository' }).click();
    await expect(rf.getByText(/Use only letters/)).toBeVisible();
    await rf.getByLabel('Repository name').fill('fresh-repo');
    await rf.getByRole('button', { name: 'Create repository' }).click();
    await expect(page.getByText('octo-dev/fresh-repo', { exact: true }).first()).toBeVisible();
    expect((await mock.state()).repos).toContain('fresh-repo');
  });

  test('previews the diff, deploys one real commit through the real engine, and shows the outcome', async ({ page, mock }) => {
    await toWorkspace(page);
    await page.getByRole('button', { name: /Preview changes/ }).click();
    const preview = page.getByLabel('Preview result');
    await expect(preview).toContainText('2 new files');
    await expect(preview).toContainText('1 changed file');
    expect((await mock.state()).commits).toBe(0); // preview wrote nothing
    await page.getByLabel('Commit message').fill('Release from E2E');
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible();
    await expect(page.getByLabel('Deployment progress')).toHaveAttribute('value', '100');
    const st = await mock.state();
    expect(st.commits).toBe(1);
    expect(st.files).toEqual({ 'README.md': '# updated readme', 'index.html': '<h1>hello</h1>', 'assets/app.js': 'console.log("zipora")' });
    const link = page.getByRole('link', { name: /View commit on GitHub/ });
    await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/octo-dev\/site\/commit\/[a-z0-9]+$/);
    await page.getByText(/Logs \(\d+\)/).click();
    await expect(page.getByLabel('Deployment logs')).toContainText('Deployed commit');
  });

  test('deploys into a target directory without touching other files', async ({ page, mock }) => {
    await toWorkspace(page);
    await page.getByLabel('Target directory', { exact: true }).fill('docs/site');
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible();
    expect(Object.keys((await mock.state()).files).sort()).toEqual(['README.md', 'docs/site/README.md', 'docs/site/assets/app.js', 'docs/site/index.html']);
  });

  test('a GitHub failure shows a clear error screen, creates no commit, and can be retried', async ({ page, mock }) => {
    await toWorkspace(page);
    await mock.failBlobs();
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByText('Permission denied')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toHaveCount(0);
    expect((await mock.state()).commits).toBe(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a running deployment can be cancelled before the commit; the branch stays untouched', async ({ page, mock }) => {
    await mock.delay(1500);
    await toWorkspace(page);
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByRole('button', { name: 'Cancel deployment' })).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: /Uploading|Processed|Plan/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel deployment' }).click();
    await expect(page.getByRole('heading', { name: 'Deployment cancelled' })).toBeVisible();
    const st = await mock.state();
    expect(st.commits).toBe(0);
    expect(st.files).toEqual({ 'README.md': 'hello from the repo' });
  });

  test('the live progress screen reports real counters and stages while running', async ({ page, mock }) => {
    await mock.delay(1200);
    await toWorkspace(page);
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByRole('list', { name: 'Deployment stages' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Uploading files' }).first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText('Elapsed')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Succeeded')).toBeVisible();
    void deploy; void SITE;
  });
});
