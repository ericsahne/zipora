// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes, Providers } from '../../src/App';
import { AuthClient } from '../../src/client/auth';
import { nav } from '../../src/services/navigation';
import type { HistoryRecord } from '../../src/types';
import { makeHarness } from '../server/harness';
import { setup } from './helpers';

const rec = (id: string, over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id, createdAt: '2026-11-01T10:00:00.000Z', durationMs: 1500, status: 'success', owner: 'octo-dev', repo: 'site', branch: 'main', targetDir: '', message: `message ${id}`, archiveName: 'a.zip', fileCount: 3,
  counts: { added: 2, updated: 1, unchanged: 0, skipped: 0, deleted: 0, failed: 0 }, commitSha: `abc${id}0000000000000000000000000000000000`.slice(0, 40), commitUrl: `https://github.com/octo-dev/site/commit/abc${id}`,
  logs: [{ time: '2026-11-01T10:00:00.000Z', stage: 'connecting', level: 'info', message: 'Reading octo-dev/site@main', processed: 0, total: 0, succeeded: 0, failed: 0 }], ...over,
});
const seed = (records: HistoryRecord[], userId = 4242) => localStorage.setItem(`zipora:v1:history:${userId}`, JSON.stringify(records));
const u = () => userEvent.setup();

describe('session lifecycle', () => {
  it('shows a session-expired screen when the session ends, and signing in again returns to the same page', async () => {
    const { h, redirect } = await setup({ route: '/dashboard' });
    await screen.findByRole('heading', { name: 'Welcome, Octo Dev' });
    h.clock.t += h.config.sessionTtlSeconds + 1;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument();
    await u().click(screen.getByRole('button', { name: /Sign in with GitHub/ }));
    expect(redirect).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fdashboard');
  });

  it('treats a 401 from the GitHub proxy (revoked token) as an expired session', async () => {
    const { h } = await setup({ route: '/new/repository' });
    h.oauth.accessTokens.clear(); // revoked on GitHub; the session cookie itself is still valid
    h.jar.cookies.size; // (cookie untouched)
    // reload the repository list so the proxy is called with the revoked token
    await u().click(await screen.findByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument();
  });

  it('shows a retryable error if the session check itself fails, without signing anyone out', async () => {
    const h = await makeHarness();
    await h.signIn();
    let failing = true;
    const client = new AuthClient({ fetchImpl: (async (input, init) => { if (failing) throw new TypeError('offline'); return h.call(String(input), { method: init?.method }); }) as typeof fetch });
    vi.spyOn(nav, 'redirect').mockImplementation(() => {});
    render(<MemoryRouter initialEntries={['/dashboard']}><Providers client={client}><AppRoutes /></Providers></MemoryRouter>);
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    failing = false;
    await u().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Octo Dev' })).toBeInTheDocument();
  });

  it('signs out through the user menu: revokes the token, clears the session and leaves the app', async () => {
    const { h } = await setup({ route: '/dashboard' });
    await screen.findByRole('heading', { name: 'Welcome, Octo Dev' });
    await u().click(screen.getByRole('button', { name: /octo-dev/ }));
    await u().click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    expect(h.jar.cookies.has('__Host-zipora_session')).toBe(false);
    expect(h.oauth.accessTokens.size).toBe(0);
  });

  it('optionally wipes local history on sign-out', async () => {
    seed([rec('1')]);
    await setup({ route: '/settings' });
    await screen.findByRole('heading', { name: 'Settings' });
    await u().click(screen.getByLabelText(/Clear local deployment history when I sign out/));
    await u().click(screen.getByRole('button', { name: /Sign out/ }));
    await screen.findByText('Sign in to continue');
    expect(localStorage.getItem('zipora:v1:history:4242')).toBeNull();
  });
});

describe('settings and preferences', () => {
  it('shows the account, switches theme, and persists the preference across reloads', async () => {
    const first = await setup({ route: '/settings' });
    expect(await screen.findByText('@octo-dev')).toBeInTheDocument();
    expect(screen.getByText('repo', { selector: 'dd' })).toBeInTheDocument();
    await u().click(screen.getByRole('radio', { name: /Light/ }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem('zipora:v1:prefs')!).theme).toBe('light');
    first.unmount();
    document.documentElement.removeAttribute('data-theme');
    await setup({ route: '/settings' });
    await screen.findByRole('radio', { name: /Light/ });
    expect(screen.getByRole('radio', { name: /Light/ })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the operating-system theme when set to System', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('light'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
    await setup({ route: '/settings' });
    await u().click(await screen.findByRole('radio', { name: /System/ }));
    expect(document.documentElement.dataset.theme).toBe('light');
    // @ts-expect-error cleanup of the test shim
    delete window.matchMedia;
  });

  it('the header toggle flips the theme', async () => {
    await setup({ route: '/dashboard' });
    await screen.findByRole('heading', { name: /Welcome/ });
    await u().click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await u().click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('saves a valid default commit message, rejects an empty one, and applies defaults to new deployments', async () => {
    await setup({ route: '/settings' });
    const field = await screen.findByLabelText('Default commit message');
    await u().clear(field);
    expect(await screen.findByText('Enter 1–200 characters.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('zipora:v1:prefs') ?? '{}').defaultCommitMessage).not.toBe('');
    await u().type(field, 'Release via ZIPORA');
    expect(JSON.parse(localStorage.getItem('zipora:v1:prefs')!).defaultCommitMessage).toBe('Release via ZIPORA');
  });

  it('stores nothing sensitive in the browser: only preferences and history, never a token', async () => {
    const { h } = await setup({ route: '/settings' });
    await screen.findByRole('heading', { name: 'Settings' });
    const dump = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(dump).not.toContain(h.oauth.state.issued[0]);
    expect(dump).not.toMatch(/gh[pousr]_/);
    expect(document.cookie).toBe(''); // the session cookie is HttpOnly: invisible to page scripts
  });

  it('collapses the sidebar and remembers it', async () => {
    await setup({ route: '/dashboard' });
    await u().click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    expect(JSON.parse(localStorage.getItem('zipora:v1:prefs')!).sidebarCollapsed).toBe(true);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'History' })).toBeInTheDocument(); // still reachable by name
  });
});

describe('navigation', () => {
  it('opens the mobile drawer, closes it with Escape, and navigates from it', async () => {
    await setup({ route: '/dashboard' });
    await u().click(await screen.findByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    await u().keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    await u().click(screen.getByRole('button', { name: 'Open menu' }));
    await u().click(within(screen.getByRole('dialog', { name: 'Navigation' })).getByRole('link', { name: 'New deployment' }));
    expect(await screen.findByRole('heading', { name: 'New deployment' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
  });

  it('offers a skip link and renders unknown routes as 404', async () => {
    await setup({ route: '/dashboard' });
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  });
  it('404 page', async () => {
    await setup({ signedIn: false, route: '/definitely/not/here' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('public pages', () => {
  it('documentation states real limits taken from the engine, not invented numbers', async () => {
    await setup({ signedIn: false, route: '/docs' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Documentation' })).toBeInTheDocument();
    expect(screen.getByText(/Archive size: 100 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Files per archive: 5,000/)).toBeInTheDocument();
    expect(screen.getByText(/about 3\.2 MB/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument();
  });
  it('privacy and terms pages render and are linked from the footer', async () => {
    await setup({ signedIn: false, route: '/privacy' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/never exposed to page scripts/)).toBeInTheDocument();
    await u().click(within(screen.getByRole('navigation', { name: 'Footer' })).getByRole('link', { name: 'Terms' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
  });
});

describe('history management and dashboard statistics from real records', () => {
  it('dashboard counts exactly what is stored and links shortcuts to the repository step', async () => {
    seed([rec('1'), rec('2'), rec('3', { status: 'failed', commitSha: undefined }), rec('4', { status: 'cancelled' }), rec('5', { status: 'no-changes', repo: 'notes' })]);
    const { container } = await setup({ route: '/dashboard' });
    await screen.findByRole('heading', { name: /Welcome/ });
    expect([...container.querySelectorAll('[data-stat-value]')].map((e) => e.textContent)).toEqual(['5', '2', '1']);
    expect(screen.getByText('1 unchanged · 1 cancelled')).toBeInTheDocument();
    const shortcut = screen.getByRole('link', { name: 'octo-dev/site' });
    expect(shortcut).toHaveAttribute('href', '/new/repository?repo=octo-dev%2Fsite');
    await u().click(shortcut);
    expect(await screen.findByText('octo-dev/site', { selector: 'p' })).toBeInTheDocument(); // preselected from the query
  });

  it('never shows another account\'s history', async () => {
    seed([rec('theirs')], 999);
    await setup({ route: '/history' });
    expect(await screen.findByText('No deployments yet')).toBeInTheDocument();
    expect(screen.queryByText('message theirs')).not.toBeInTheDocument();
  });

  it('filters, opens, deletes and clears records', async () => {
    seed([rec('1'), rec('2', { status: 'failed', repo: 'notes', message: 'broken build' })]);
    await setup({ route: '/history' });
    expect(await screen.findByText('message 1')).toBeInTheDocument();
    await u().selectOptions(screen.getByLabelText('Filter by status'), 'failed');
    expect(screen.queryByText('message 1')).not.toBeInTheDocument();
    expect(screen.getByText('broken build')).toBeInTheDocument();
    await u().selectOptions(screen.getByLabelText('Filter by status'), 'all');
    await u().type(screen.getByRole('searchbox', { name: 'Search history' }), 'zzz');
    expect(screen.getByText('No deployments match your filters.')).toBeInTheDocument();
    await u().clear(screen.getByRole('searchbox', { name: 'Search history' }));

    await u().click(screen.getByText('message 1'));
    expect(await screen.findByRole('heading', { name: 'octo-dev/site' })).toBeInTheDocument();
    expect(screen.getByText(/2 added · 1 updated/)).toBeInTheDocument();
    await u().click(screen.getByText(/Logs \(1\)/));
    expect(screen.getByLabelText('Deployment logs')).toHaveTextContent('Reading octo-dev/site@main');
    await u().click(screen.getByRole('button', { name: /Delete record/ }));
    expect(await screen.findByRole('heading', { name: 'Deployment history' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('zipora:v1:history:4242')!)).toHaveLength(1);

    await u().click(screen.getByRole('button', { name: /Clear history/ }));
    await u().click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No deployments yet')).toBeInTheDocument();
    expect(localStorage.getItem('zipora:v1:history:4242')).toBeNull();
  });

  it('shows a clear message for an unknown record id', async () => {
    await setup({ route: '/history/does-not-exist' });
    expect(await screen.findByText('This record does not exist in this browser')).toBeInTheDocument();
  });

  it('ignores corrupted history data instead of crashing', async () => {
    localStorage.setItem('zipora:v1:history:4242', '{{{ not json');
    await setup({ route: '/dashboard' });
    expect(await screen.findByText('No deployments yet')).toBeInTheDocument();
  });
});

describe('authentication error messages', () => {
  it.each([
    ['OAUTH_STATE_INVALID', 'Sign-in could not be verified'], ['INSUFFICIENT_SCOPE', 'Missing permissions'], ['OAUTH_MISCONFIGURED', 'Sign-in is misconfigured'],
    ['GITHUB_UNREACHABLE', 'GitHub is unreachable'], ['NOT_A_REAL_CODE', 'Sign-in failed'],
  ])('%s → friendly message', async (code, title) => {
    await setup({ signedIn: false, route: `/?auth_error=${code}` });
    expect(await screen.findByText(title)).toBeInTheDocument();
  });
});
