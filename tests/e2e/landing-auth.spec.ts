import { expect, signIn, test } from './fixtures';

test.describe('landing page and GitHub login (MOCKED GitHub)', () => {
  test('landing page presents the product with working navigation', async ({ page, mock }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Deploy Anything.');
    await expect(page.getByRole('heading', { name: 'Built for careful deployments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await page.getByRole('link', { name: 'Read the docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Documentation' })).toBeVisible();
    void mock;
  });

  test('the CTA runs the real OAuth redirect chain, sets an HttpOnly session cookie and lands on the dashboard', async ({ page, context, mock }) => {
    await signIn(page);
    await expect(page.getByRole('link', { name: '@octo-dev' })).toBeVisible();
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name.endsWith('zipora_session'))!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Lax');
    expect(cookies.find((c) => c.name.endsWith('zipora_oauth'))).toBeUndefined(); // single-use state cookie was consumed
    expect(await page.evaluate(() => document.cookie)).toBe(''); // invisible to page scripts
    expect((await mock.state()).tokensLive).toBe(1);
  });

  test('the GitHub token never reaches page storage', async ({ page, mock }) => {
    await signIn(page);
    const dump = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.documentElement.outerHTML);
    expect(dump).not.toMatch(/gh[pousr]_[A-Za-z0-9]{10}/);
    void mock;
  });

  test('protected pages redirect signed-out visitors, then return them after sign-in', async ({ page, mock }) => {
    await page.goto('/history');
    await expect(page).toHaveURL(/\/\?returnTo=%2Fhistory/);
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await page.getByRole('button', { name: /Sign in with GitHub/ }).first().click();
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Deployment history' })).toBeVisible();
    void mock;
  });

  test('OAuth failure redirects show a friendly message', async ({ page, mock }) => {
    await page.goto('/?auth_error=ACCESS_DENIED');
    await expect(page.getByText('Authorization was cancelled')).toBeVisible();
    void mock;
  });

  test('signing out revokes the token and ends the session', async ({ page, mock }) => {
    await signIn(page);
    await page.getByRole('button', { name: /octo-dev/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    expect((await mock.state()).tokensLive).toBe(0);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/\?returnTo=/);
  });

  test('a revoked token shows the session-expired screen', async ({ page, mock }) => {
    await signIn(page);
    await mock.revoke();
    await page.goto('/new/repository');
    await expect(page.getByRole('heading', { name: 'Session expired' })).toBeVisible();
  });
});
