import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * MOCKED GITHUB. These fixtures drive the real ZIPORA UI and server code against scripts/e2e-server.mjs, where GitHub's
 * OAuth and REST API are an in-memory fake. They never contact github.com: the first OAuth hop is rewritten to the mock
 * and any request that leaves localhost fails the test.
 */
export interface MockState { files: Record<string, string>; branches: string[]; commits: number; blobs: number; repos: string[]; tokensIssued: number; tokensLive: number }

export const SITE = { 'index.html': '<h1>hello</h1>', 'assets/app.js': 'console.log("zipora")', 'README.md': '# updated readme' };

export async function makeZip(files: Record<string, string>, name = 'site.zip') {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(p, c);
  return { name, mimeType: 'application/zip', buffer: Buffer.from(await z.generateAsync({ type: 'uint8array' })) };
}

export interface Mock { state(): Promise<MockState>; revoke(): Promise<void>; delay(ms: number): Promise<void>; failBlobs(): Promise<void> }

async function guard(context: BrowserContext, base: string, external: string[]) {
  // Redirect hops are not interceptable, so the first hop (/api/auth/login, real server code) is fetched and its Location rewritten.
  await context.route('**/api/auth/login*', async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const loc = res.headers().location ?? '';
    await route.fulfill({ response: res, headers: { ...res.headers(), location: `${base}/__mock/authorize?authorize_url=${encodeURIComponent(loc)}` } });
  });
  context.on('request', (r) => { if (new URL(r.url()).hostname !== 'localhost') external.push(r.url()); });
}

export const test = base.extend<{ mock: Mock; problems: string[]; external: string[] }>({
  external: async ({}, use) => { const list: string[] = []; await use(list); },
  problems: async ({ page }, use) => {
    const list: string[] = [];
    // CSP violations and script errors fail the test. HTTP-status noise ("Failed to load resource") is expected in failure-path tests.
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) list.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
    await use(list);
  },
  mock: async ({ request, baseURL, context, external, problems }, use) => {
    await request.get('/__mock/reset');
    await guard(context, baseURL!, external);
    await use({
      state: async () => (await request.get('/__mock/state')).json(),
      revoke: async () => { await request.get('/__mock/revoke'); },
      delay: async (ms) => { await request.get(`/__mock/delay?ms=${ms}`); },
      failBlobs: async () => { await request.get('/__mock/fail-blobs'); },
    });
    expect(external, 'no request may leave localhost (tests must stay mocked)').toEqual([]);
    expect(problems, 'no console errors / CSP violations').toEqual([]);
  },
});
export { expect };

/** Real sign-in through the real server: login → (mock) GitHub → callback → dashboard. */
export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Sign in with GitHub/ }).first().click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome, Octo Dev' })).toBeVisible();
}

export async function uploadZip(page: Page, files: Record<string, string> = SITE, name = 'site.zip') {
  await page.goto('/new');
  await page.setInputFiles('[data-testid=zip-input]', await makeZip(files, name));
  await expect(page.getByRole('tree', { name: 'Archive contents' })).toBeVisible();
}

/** Upload → choose octo-dev/site → continue to the workspace. */
export async function toWorkspace(page: Page, files: Record<string, string> = SITE) {
  await uploadZip(page, files);
  await page.getByRole('link', { name: /Continue to repository/ }).click();
  await page.getByRole('button', { name: /octo-dev\/site/ }).click();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
  await page.getByRole('link', { name: /Continue to review/ }).click();
  await expect(page.getByRole('heading', { name: 'Review and deploy' })).toBeVisible();
}

export async function deploy(page: Page) {
  await toWorkspace(page);
  await page.getByRole('button', { name: /Deploy to main/ }).click();
  await expect(page.getByRole('heading', { name: 'Deployment complete' })).toBeVisible();
}

export async function a11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}
