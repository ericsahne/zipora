import { expect, makeZip, signIn, SITE, test, uploadZip } from './fixtures';

test.describe('ZIP upload (MOCKED GitHub)', () => {
  test.beforeEach(async ({ page, mock }) => { void mock; await signIn(page); });

  test('validates and previews a real archive; remove and replace work', async ({ page }) => {
    await uploadZip(page);
    await expect(page.getByText('3 files', { exact: true })).toBeVisible();
    await expect(page.getByText('site.zip')).toBeVisible();
    await page.getByRole('treeitem', { name: /assets/ }).click();
    await page.getByRole('treeitem', { name: /app\.js/ }).click();
    await expect(page.getByLabel('File preview')).toContainText('console.log("zipora")');
    await page.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByText(/Drag and drop a ZIP file here|Choose a ZIP file from your phone/)).toBeVisible();
    await page.setInputFiles('[data-testid=zip-input]', await makeZip({ 'a.txt': '1', 'b.txt': '2' }, 'second.zip'));
    await expect(page.getByText('second.zip')).toBeVisible();
    await page.getByLabel('Replace the archive').setInputFiles(await makeZip({ 'only.txt': 'x' }, 'third.zip'));
    await expect(page.getByText('third.zip')).toBeVisible();
    await expect(page.getByText('1 file', { exact: true })).toBeVisible();
  });

  test('rejects a file that is not a ZIP with an actionable error', async ({ page }) => {
    await page.goto('/new');
    await page.setInputFiles('[data-testid=zip-input]', { name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip archive') });
    await expect(page.getByRole('alert')).toContainText('Not a valid ZIP archive');
    await expect(page.getByRole('alert')).toContainText('INVALID_ZIP');
  });

  test('blocks dangerous archives and shows why', async ({ page }) => {
    await uploadZip(page, { 'A.txt': '1', 'a.txt': '2', 'ok.txt': '3' }, 'clash.zip');
    await expect(page.getByText('This archive cannot be deployed as it is')).toBeVisible();
    await expect(page.getByText('CASE_COLLISION')).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue to repository/ })).toBeDisabled();
  });

  test('file names are shown as text, never interpreted as HTML', async ({ page }) => {
    await uploadZip(page, { '<img src=x onerror=window.__pwned=1>.txt': 'x', ...SITE }, 'evil.zip');
    await expect(page.getByText('<img src=x onerror=window.__pwned=1>.txt')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator('main img').count()).toBe(0);
  });

  test('the file explorer is keyboard operable (arrow keys, expand/collapse)', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'keyboard interaction is checked on desktop');
    await uploadZip(page);
    await page.getByRole('treeitem', { name: /assets/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('treeitem', { name: /app\.js/ })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('treeitem', { name: /app\.js/ })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('treeitem', { name: /app\.js/ })).toHaveCount(0);
  });
});
