import { deploy, expect, makeZip, signIn, SITE, test, toWorkspace, uploadZip } from './fixtures';

// Runs on the "android-chrome" project only: Pixel 7 emulation (412x915, touch, DPR 2.625) in real Chromium. MOCKED GitHub.
test.describe('Android Chrome experience', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-only suite');

  const noOverflow = async (page: import('@playwright/test').Page, label: string) => {
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(m.scroll, `${label}: horizontal overflow (scrollWidth ${m.scroll} > ${m.inner})`).toBeLessThanOrEqual(m.inner);
  };
  /** Standalone controls (not links inside running text) must be at least 43px tall. */
  const smallTargets = (page: import('@playwright/test').Page) => page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href], select')]
      .filter((e) => !e.closest('article, p, dd, dt, li > p') && !e.classList.contains('sr-only'))
      .map((e) => ({ name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
      .filter((t) => t.h > 4 && t.w > 4 && t.h < 43));

  test('declares a mobile viewport and has no horizontal overflow on any public page', async ({ page, mock }) => {
    void mock;
    for (const path of ['/', '/docs', '/privacy', '/terms']) { await page.goto(path); await noOverflow(page, path); }
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('width=device-width');
  });

  test('no horizontal overflow and no undersized touch targets across the signed-in app', async ({ page, mock }) => {
    void mock;
    await signIn(page);
    const small: string[] = [];
    const check = async (label: string) => { await noOverflow(page, label); for (const t of await smallTargets(page)) small.push(`${label}: ${t.name} (${Math.round(t.h)}px)`); };
    await check('dashboard');
    await uploadZip(page, { ...SITE, 'a/very/deeply/nested/folder/with/a-really-long-file-name-that-must-not-overflow-the-screen.txt': 'x' });
    await check('upload');
    await page.getByRole('link', { name: /Continue to repository/ }).click();
    await page.getByRole('button', { name: /octo-dev\/site/ }).click();
    await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
    await check('repository');
    await page.getByRole('link', { name: /Continue to review/ }).click();
    await expect(page.getByRole('heading', { name: 'Review and deploy' })).toBeVisible();
    await check('workspace');
    await page.getByRole('button', { name: /Deploy to main/ }).tap();
    await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible();
    await page.getByText(/Logs \(\d+\)/).tap();
    await check('result+logs');
    for (const p of ['/history', '/settings']) { await page.goto(p); await check(p); }
    expect(small, 'touch targets under 43px').toEqual([]);
  });

  test('phone navigation: bottom bar visible, sidebar hidden, drawer traps focus and closes with Escape', async ({ page, mock }) => {
    void mock;
    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.getByRole('link', { name: 'History' }).last().tap();
    await expect(page).toHaveURL(/\/history$/);
    await page.getByRole('button', { name: 'Open menu' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true); } // focus stays trapped
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused(); // focus returns to the opener
  });

  test('ZIP selection uses the native file chooser and accepts the MIME types Android reports', async ({ page, mock }) => {
    void mock;
    await signIn(page);
    await page.goto('/new');
    const accept = await page.locator('[data-testid=zip-input]').getAttribute('accept');
    for (const t of ['.zip', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']) expect(accept).toContain(t);
    await expect(page.getByText('Choose a ZIP file from your phone')).toBeVisible(); // touch wording, not "drag and drop"
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Browse files' }).tap()]);
    await chooser.setFiles(await makeZip(SITE));
    await expect(page.getByRole('tree', { name: 'Archive contents' })).toBeVisible();
  });

  test('the whole deploy workflow works by touch only, and the result screen is first on the page', async ({ page, mock }) => {
    await signIn(page);
    await page.goto('/new');
    await page.setInputFiles('[data-testid=zip-input]', await makeZip(SITE));
    await page.getByRole('link', { name: /Continue to repository/ }).tap();
    await page.getByRole('button', { name: /octo-dev\/site/ }).tap();
    await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
    await page.getByRole('link', { name: /Continue to review/ }).tap();
    await page.getByRole('button', { name: /Deploy to main/ }).tap();
    const outcome = page.getByRole('heading', { name: 'Deployment complete' });
    await expect(outcome).toBeVisible();
    const top = (await outcome.boundingBox())!.y;
    expect(top, 'result heading must be visible (not scrolled above the viewport) and near the top on a phone').toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(400);
    expect((await mock.state()).commits).toBe(1);
    await expect(page.getByRole('link', { name: /View commit on GitHub/ })).toBeInViewport();
  });

  test('logs and history exports download through the mobile browser', async ({ page, mock }) => {
    void mock;
    await signIn(page);
    await deploy(page);
    const [logs] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download logs' }).first().tap()]);
    expect(logs.suggestedFilename()).toMatch(/\.log\.txt$/);
    await page.goto('/history');
    const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export \(ZIP\)/ }).tap()]);
    expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  });

  test('text inputs use 16px+ fonts so Android never zooms the page', async ({ page, mock }) => {
    void mock;
    await signIn(page);
    await toWorkspace(page);
    const sizes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input[type=text], input:not([type]), select')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });
});
