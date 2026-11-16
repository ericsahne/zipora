import { a11y, deploy, expect, signIn, test, uploadZip } from './fixtures';

// Automated WCAG 2.0/2.1 A+AA scan (axe-core) in real Chromium. Automated tools find roughly a third of accessibility
// problems: this is a floor, not a certification. MOCKED GitHub.
test.describe('accessibility (axe-core, serious+critical violations)', () => {
  const report = (v: Awaited<ReturnType<typeof a11y>>) => v.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);

  for (const theme of ['dark', 'light'] as const) {
    test(`public pages — ${theme} theme`, async ({ page, mock }) => {
      void mock;
      await page.addInitScript((t) => localStorage.setItem('zipora:v1:prefs', JSON.stringify({ theme: t })), theme);
      for (const path of ['/', '/docs', '/privacy', '/terms']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect.soft(report(await a11y(page)), path).toEqual([]);
      }
    });

    test(`signed-in app — ${theme} theme`, async ({ page, mock }) => {
      void mock;
      await page.addInitScript((t) => localStorage.setItem('zipora:v1:prefs', JSON.stringify({ theme: t })), theme);
      await signIn(page);
      expect.soft(report(await a11y(page)), 'dashboard').toEqual([]);
      await uploadZip(page);
      expect.soft(report(await a11y(page)), 'upload').toEqual([]);
      await page.getByRole('link', { name: /Continue to repository/ }).click();
      await page.getByRole('button', { name: /octo-dev\/site/ }).click();
      await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
      expect.soft(report(await a11y(page)), 'repository').toEqual([]);
      await page.getByRole('link', { name: /Continue to review/ }).click();
      await page.getByRole('button', { name: /Deploy to main/ }).click();
      await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible();
      expect.soft(report(await a11y(page)), 'workspace result').toEqual([]);
      for (const p of ['/history', '/settings']) { await page.goto(p); await page.waitForLoadState('networkidle'); expect.soft(report(await a11y(page)), p).toEqual([]); }
      void deploy;
    });
  }
});
