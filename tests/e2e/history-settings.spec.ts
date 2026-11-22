import JSZip from 'jszip';
import { deploy, expect, signIn, test } from './fixtures';

test.describe('history and settings (MOCKED GitHub)', () => {
  test.beforeEach(async ({ page, mock }) => { void mock; await signIn(page); });

  test('history records a real deployment with commit link, details and logs; per-user storage key', async ({ page }) => {
    await deploy(page);
    await page.getByRole('link', { name: 'View details' }).click();
    await expect(page.getByRole('heading', { name: 'octo-dev/site' })).toBeVisible();
    await expect(page.getByText('Deployed', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /octo-dev\/site/ }).first()).toHaveAttribute('href', 'https://github.com/octo-dev/site/tree/main');
    await page.getByText(/Logs \(\d+\)/).click();
    await expect(page.getByLabel('Deployment logs')).toContainText('Reading octo-dev/site@main');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain('zipora:v1:history:4242'); // isolated per GitHub user id
  });

  test('search, filter, sort, delete one record, and clear all', async ({ page }) => {
    await deploy(page);
    await page.goto('/history');
    await expect(page.getByText('Deploy via ZIPORA')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search history' }).fill('nothing-matches');
    await expect(page.getByText('No deployments match your filters.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search history' }).fill('');
    await page.getByLabel('Filter by status').selectOption('failed');
    await expect(page.getByText('No deployments match your filters.')).toBeVisible();
    await page.getByLabel('Filter by status').selectOption('all');
    await page.getByRole('button', { name: /^Delete record:/ }).click();
    await page.getByRole('button', { name: /^Confirm delete:/ }).click();
    await expect(page.getByText('No deployments yet')).toBeVisible();
  });

  test('exports history as a downloadable ZIP with logs and no credentials', async ({ page }) => {
    await deploy(page);
    await page.goto('/history');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export \(ZIP\)/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^zipora-history-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile((await download.path())!));
    const names = Object.keys(zip.files);
    expect(names).toContain('history.json');
    expect(names.some((n) => n.startsWith('logs/') && n.endsWith('.txt'))).toBe(true);
    const history = JSON.parse(await zip.file('history.json')!.async('string'));
    expect(history.records).toHaveLength(1);
    expect(history.records[0]).toMatchObject({ owner: 'octo-dev', repo: 'site', status: 'success' });
    const all = (await Promise.all(names.filter((n) => !zip.files[n].dir).map((n) => zip.file(n)!.async('string')))).join('\n');
    expect(all).not.toMatch(/gh[pousr]_[A-Za-z0-9]{10}/);
  });

  test('downloads the deployment logs as a text file', async ({ page }) => {
    await deploy(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download logs' }).first().click()]);
    expect(download.suggestedFilename()).toMatch(/\.log\.txt$/);
  });

  test('theme and preferences persist across a reload', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: /Light/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('Default commit message').fill('Shipped by ZIPORA');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // applied before first paint by theme-init.js
    await expect(page.getByLabel('Default commit message')).toHaveValue('Shipped by ZIPORA');
    await expect(page.getByText('@octo-dev')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('zipora:v1:prefs') ?? '');
    expect(stored).not.toMatch(/token|secret/i);
  });

  test('signing out from settings can wipe local history', async ({ page }) => {
    await deploy(page);
    await page.goto('/settings');
    await page.getByLabel(/Clear local deployment history when I sign out/).check();
    await page.getByRole('button', { name: /Sign out/ }).click();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('zipora:v1:history:4242'))).toBeNull();
  });
});
