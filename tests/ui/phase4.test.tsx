// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentProgress, LogViewer, STAGES } from '../../src/components/DeploymentProgress';
import { RunOutcome } from '../../src/components/RunOutcome';
import type { DeployEvent, DeployResult } from '../../src/engine';
import { EngineError } from '../../src/engine';
import { buildHistoryZip } from '../../src/services/export';
import { ERROR_GUIDE } from '../../src/services/errors';
import type { HistoryRecord } from '../../src/types';
import { formatRelative, repoUrl } from '../../src/utils/format';
import { setup } from './helpers';

const ev = (stage: DeployEvent['stage'], t: string, over: Partial<DeployEvent> = {}): DeployEvent => ({ time: `2026-11-01T10:00:${t}.000Z`, stage, level: 'info', message: `${stage} message`, processed: 0, total: 0, succeeded: 0, failed: 0, ...over });
const rec = (id: string, over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id, createdAt: '2026-11-01T10:00:00.000Z', durationMs: 1500, status: 'success', owner: 'octo-dev', repo: 'site', branch: 'main', targetDir: '', message: `message ${id}`, archiveName: 'a.zip', fileCount: 3,
  counts: { added: 2, updated: 1, unchanged: 0, skipped: 0, deleted: 0, failed: 0 }, commitSha: `abc${id}`, commitUrl: `https://github.com/octo-dev/site/commit/abc${id}`, logs: [ev('connecting', '00')], ...over,
});
const result = (over: Partial<DeployResult> = {}): DeployResult => ({ status: 'success', commitSha: 'abcdef1234567', commitUrl: 'https://github.com/o/r/commit/abcdef1234567', counts: { added: 3, updated: 1, unchanged: 2, skipped: 0, deleted: 0, failed: 0 }, logs: [], ...over });
const seed = (records: HistoryRecord[]) => localStorage.setItem('zipora:v1:history:4242', JSON.stringify(records));

afterEach(() => vi.restoreAllMocks());

describe('history export', () => {
  it('builds a ZIP with history.json (no logs inline), one log per deployment, and no credentials', async () => {
    const blob = await buildHistoryZip([rec('1'), rec('2', { owner: 'we ird/../x', repo: 'r<>' })], 'octo-dev');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain('history.json');
    expect(names).toContain('README.txt');
    const logs = names.filter((n) => n.startsWith('logs/'));
    expect(logs).toHaveLength(2);
    for (const n of logs) expect(n).toMatch(/^logs\/[A-Za-z0-9._-]+\.txt$/); // hostile owner/repo names cannot create odd paths
    const h = JSON.parse(await zip.file('history.json')!.async('string'));
    expect(h.account).toBe('octo-dev');
    expect(h.records).toHaveLength(2);
    expect(h.records[0]).not.toHaveProperty('logs');
    expect(JSON.stringify(h)).not.toMatch(/gh[pousr]_/);
  });
});

describe('LogViewer', () => {
  it('opens and closes, copies, reports copy failure, and downloads', async () => {
    const u = userEvent.setup();
    const created: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { created.push(b); return 'blob:x'; }, revokeObjectURL: () => {} }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<LogViewer logs={[ev('connecting', '00'), ev('commit', '01', { level: 'error', message: 'boom' })]} name="t" />);
    const toggle = screen.getByRole('button', { name: /Logs \(2\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Deployment logs')).not.toBeInTheDocument();
    await u.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Deployment logs')).toHaveTextContent('boom');
    await u.click(screen.getByRole('button', { name: 'Copy logs' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[ERROR] commit: boom'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await u.click(screen.getByRole('button', { name: 'Copied' }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Download logs' }));
    expect(created).toHaveLength(1);
    expect(await created[0].text()).toContain('connecting: connecting message');
  });
});

describe('DeploymentProgress (driven by real event timestamps)', () => {
  it('shows counters and per-stage durations computed from event times', () => {
    const events = [ev('connecting', '00'), ev('preparing', '01'), ev('processing', '03', { total: 4, processed: 4, succeeded: 4 }), ev('tree', '07'), ev('commit', '08'), ev('branch', '09'), ev('complete', '10', { total: 4, processed: 4, succeeded: 4 })];
    render(<DeploymentProgress events={events} result={result()} />);
    expect(screen.getByLabelText('Deployment progress')).toHaveAttribute('value', '100');
    const stages = within(screen.getByRole('list', { name: 'Deployment stages' }));
    expect(stages.getByText('Connecting to GitHub').closest('li')).toHaveTextContent('1.0 s');
    expect(stages.getByText('Uploading files').closest('li')).toHaveTextContent('4.0 s');
    expect(screen.getByText('Elapsed').nextSibling).toHaveTextContent('10.0 s');
    expect(screen.getByText('Processed').nextSibling).toHaveTextContent('4/4');
    expect(STAGES.map((s) => s.key)).toEqual(['connecting', 'preparing', 'processing', 'tree', 'commit', 'branch', 'complete']);
  });
  it('while running, the current stage and elapsed time are measured against the live clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T10:00:08.000Z'));
    const events = [ev('connecting', '00'), ev('preparing', '01'), ev('processing', '03', { total: 10, processed: 4, succeeded: 4 })];
    render(<DeploymentProgress events={events} />); // no result yet: still running
    const stages = within(screen.getByRole('list', { name: 'Deployment stages' }));
    expect(stages.getByText('Uploading files').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(stages.getByText('Uploading files').closest('li')).toHaveTextContent('5.0 s'); // 03 → now (08)
    expect(screen.getByText('Elapsed').nextSibling).toHaveTextContent('8.0 s');
    expect(screen.getByLabelText('Deployment progress')).toHaveAttribute('value', '40');
    expect(screen.getByRole('status')).toHaveTextContent('processing message');
  });
  it('marks the failing stage and never reports 100% for a failed run', () => {
    const events = [ev('connecting', '00'), ev('processing', '01', { total: 4, processed: 1, succeeded: 0, failed: 1, level: 'error' })];
    render(<DeploymentProgress events={events} result={result({ status: 'failed', error: new EngineError('PERMISSION', 'denied') })} />);
    expect(screen.getByLabelText('Deployment progress')).toHaveAttribute('value', '25');
    expect(screen.getByText('Failed').nextSibling).toHaveTextContent('1');
  });
});

describe('RunOutcome screens', () => {
  const wrap = (r: DeployResult) => render(<MemoryRouter><RunOutcome result={r} owner="o" repo="r" branch="feature/x y" recordId="rid" onRetry={() => {}} onNew={() => {}} /></MemoryRouter>);
  it('success: commit and branch links point to github.com and are safe', () => {
    wrap(result());
    expect(screen.getByRole('heading', { name: 'Deployment complete' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View commit on GitHub/ })).toHaveAttribute('href', 'https://github.com/o/r/commit/abcdef1234567');
    expect(screen.getByRole('link', { name: /Open branch/ })).toHaveAttribute('href', 'https://github.com/o/r/tree/feature/x%20y');
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/history/rid');
  });
  it('refuses to link a commit URL that is not on github.com', () => {
    wrap(result({ commitUrl: 'javascript:alert(1)' }));
    expect(screen.queryByRole('link', { name: /View commit/ })).not.toBeInTheDocument();
  });
  it('no-changes, cancelled and failed each have a clear screen with the right actions', () => {
    wrap(result({ status: 'no-changes' })); expect(screen.getByRole('heading', { name: 'No changes' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Back to review' })).toBeInTheDocument();
    wrap(result({ status: 'cancelled' })); expect(screen.getByRole('heading', { name: 'Deployment cancelled' })).toBeInTheDocument();
    wrap(result({ status: 'failed', error: new EngineError('RATE_LIMIT', 'limit hit', { hint: 'wait' }) }));
    expect(screen.getByText('GitHub rate limit reached')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('history page', () => {
  it('filters by repository, sorts, links commits, and deletes one record with confirmation', async () => {
    const u = userEvent.setup();
    seed([rec('3', { repo: 'notes', createdAt: '2026-11-03T00:00:00.000Z' }), rec('2', { createdAt: '2026-11-02T00:00:00.000Z' }), rec('1', { createdAt: '2026-11-01T00:00:00.000Z' })]);
    await setup({ route: '/history' });
    expect(await screen.findByText('3 deployments')).toBeInTheDocument();
    const order = () => screen.getAllByText(/^message \d$/).map((e) => e.textContent);
    expect(order()).toEqual(['message 3', 'message 2', 'message 1']);
    await u.selectOptions(screen.getByLabelText('Sort order'), 'old');
    expect(order()).toEqual(['message 1', 'message 2', 'message 3']);
    await u.selectOptions(screen.getByLabelText('Filter by repository'), 'octo-dev/notes');
    expect(order()).toEqual(['message 3']);
    expect(screen.getByText('1 deployment of 3')).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Filter by repository'), 'all');
    expect(screen.getAllByRole('link', { name: /^Open commit/ })[0]).toHaveAttribute('href', expect.stringMatching(/^https:\/\/github\.com\/octo-dev\/site\/commit\//));

    await u.click(screen.getByRole('button', { name: 'Delete record: message 2' }));
    expect(screen.getByText('Delete this record?')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Keep' }));
    expect(order()).toHaveLength(3);
    await u.click(screen.getByRole('button', { name: 'Delete record: message 2' }));
    await u.click(screen.getByRole('button', { name: 'Confirm delete: message 2' }));
    await waitFor(() => expect(order()).toEqual(['message 1', 'message 3']));
    expect(JSON.parse(localStorage.getItem('zipora:v1:history:4242')!).map((r: HistoryRecord) => r.id).sort()).toEqual(['1', '3']);
  });

  it('exports the history through a real download of a ZIP', async () => {
    const u = userEvent.setup();
    seed([rec('1')]);
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:y'; }, revokeObjectURL: () => {} }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await setup({ route: '/history' });
    await u.click(await screen.findByRole('button', { name: /Export \(ZIP\)/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const zip = await JSZip.loadAsync(await blobs[0].arrayBuffer());
    expect(Object.keys(zip.files)).toContain('history.json');
  });
});

describe('documentation stays in sync with the code', () => {
  it('every error code in the guide is unique, explained, and shown in the docs table', async () => {
    const codes = ERROR_GUIDE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of ERROR_GUIDE) { expect(e.cause.length).toBeGreaterThan(10); expect(e.fix.length).toBeGreaterThan(5); }
    for (const must of ['INVALID_ZIP', 'CORRUPTED_ZIP', 'FILE_TOO_LARGE', 'PATH_COLLISION', 'AUTH', 'PERMISSION', 'RATE_LIMIT', 'CONFLICT', 'UPLOAD_FAILED', 'CANCELLED', 'TREE_TRUNCATED']) expect(codes).toContain(must);
    await setup({ signedIn: false, route: '/docs' });
    const table = await screen.findByRole('region', { name: 'Error reference table' });
    for (const c of codes) expect(within(table).getByText(c)).toBeInTheDocument();
    for (const section of ['Getting started', 'Connecting GitHub', 'Uploading ZIP files', 'Selecting repositories', 'Branch selection', 'Deployment process', 'Supported file sizes', 'Common errors', 'Troubleshooting', 'Using ZIPORA on Android', 'Security and privacy']) expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('relative times and repository URLs', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(formatRelative('2026-11-10T11:59:30Z', now)).toMatch(/30 seconds ago/);
    expect(formatRelative('2026-11-10T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(formatRelative('not a date', now)).toBe('—');
    expect(repoUrl('o', 'r', 'a/b c')).toBe('https://github.com/o/r/tree/a/b%20c');
    expect(repoUrl('o', 'r')).toBe('https://github.com/o/r');
  });
});
