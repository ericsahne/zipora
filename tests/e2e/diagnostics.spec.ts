import { a11y, expect, signIn, test, uploadZip } from './fixtures';

// MOCKED GitHub. Checks the diagnostics panel in a real browser: it shows what GitHub answered, never a token, fits a phone screen
// and is accessible. (The failure scenarios — GitHub App token, missing scope — are covered by the Vitest suites.)
test.describe('GitHub access diagnostics (MOCKED GitHub)', () => {
  test('explains the account, token type and repositories, without exposing the token', async ({ page, mock, isMobile }) => {
    await signIn(page);
    await uploadZip(page);
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    await expect(page.getByRole('list', { name: 'Repositories' })).toBeVisible();
    await page.getByRole('button', { name: 'Not seeing your repositories?' }).click();
    await page.getByRole('button', { name: 'Run diagnostics' }).click();
    const panel = page.getByRole('region', { name: 'GitHub access diagnostics' });
    await expect(panel.getByText('ALL_CHECKS_PASSED')).toBeVisible();
    await expect(panel).toContainText('@octo-dev');
    await expect(panel).toContainText('OAuth App token (gho_…)');
    await expect(panel).toContainText('repo'); // scopes reported by GitHub
    await expect(panel.getByText(/Same token for every check/)).toBeVisible();

    const text = await page.evaluate(() => document.documentElement.outerHTML);
    expect(text).not.toMatch(/gho_[A-Za-z0-9]{10}/); // the token never reaches the page

    if (isMobile) {
      const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(m.scroll, 'diagnostics must not overflow the phone screen').toBeLessThanOrEqual(m.inner);
    }
    expect((await a11y(page)).map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    void mock;
  });

  test('a selected repository can be checked directly', async ({ page, mock }) => {
    await signIn(page);
    await uploadZip(page);
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    await page.getByRole('button', { name: /octo-dev\/site/ }).click();
    await page.getByRole('button', { name: 'Not seeing your repositories?' }).click();
    await page.getByRole('button', { name: 'Run diagnostics' }).click();
    const panel = page.getByRole('region', { name: 'GitHub access diagnostics' });
    await expect(panel).toContainText('octo-dev/site');
    await expect(panel.getByText('ALL_CHECKS_PASSED')).toBeVisible();
    void mock;
  });
});
