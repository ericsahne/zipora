import { mkdirSync } from 'node:fs';
import { deploy, expect, signIn, test, uploadZip } from './fixtures';

// Regenerates docs/screenshots/*.png for the README. Run with: SCREENSHOTS=1 npm run e2e -- screenshots
// Images show a MOCKED GitHub (fake repositories and data), captured from the real UI in real Chromium.
test.describe('README screenshots (MOCKED GitHub data)', () => {
  test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate');
  test('capture', async ({ page, mock }, info) => {
    void mock;
    const out = 'docs/screenshots';
    mkdirSync(out, { recursive: true });
    const tag = info.project.name === 'android-chrome' ? 'mobile' : 'desktop';
    const shot = async (name: string, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: full }); };
    await page.goto('/'); await shot('landing');
    await signIn(page); await shot('dashboard-empty');
    await uploadZip(page, { 'index.html': '<h1>hello</h1>', 'assets/app.js': 'console.log(1)', 'assets/styles.css': 'body{}', 'README.md': '# My site' }, 'my-site.zip');
    await page.getByRole('treeitem', { name: /assets/ }).first().click(); await shot('upload');
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    await page.getByRole('button', { name: /octo-dev\/site/ }).click();
    await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main'); await shot('repository');
    await page.getByRole('link', { name: /Continue to review/ }).click();
    await page.getByRole('button', { name: /Preview changes/ }).click();
    await expect(page.getByLabel('Preview result')).toBeVisible(); await shot('workspace');
    await page.getByRole('button', { name: /Deploy to main/ }).click();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible(); await shot('deployed');
    await page.goto('/history'); await shot('history');
    await page.goto('/settings'); await shot('settings');
    void deploy;
  });
});
