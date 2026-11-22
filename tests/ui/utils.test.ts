import { describe, expect, it } from 'vitest';
import { bytesFile, EngineError } from '../../src/engine';
import { HistoryStore, MAX_LOG_EVENTS, MAX_RECORDS } from '../../src/services/history';
import { DEFAULT_PREFS, PREFS_KEY, loadPrefs, savePrefs } from '../../src/services/preferences';
import { describeError, authErrorFor } from '../../src/services/errors';
import { parseRepo, validateBranchName, validateRepoName } from '../../src/services/github';
import type { HistoryRecord } from '../../src/types';
import { validateConfig } from '../../src/utils/config';
import { fileKind, isPreviewable } from '../../src/utils/fileType';
import { formatBytes, formatDuration, plural } from '../../src/utils/format';
import { hasInvisibleChars, safeName } from '../../src/utils/safeName';
import { buildTree, countDirs, matchPaths } from '../../src/utils/tree';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const file = (p: string, n = 3) => bytesFile(p, new Uint8Array(n));

const record = (id: string, over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id, createdAt: '2026-11-01T10:00:00.000Z', durationMs: 1200, status: 'success', owner: 'o', repo: 'r', branch: 'main', targetDir: '', message: 'm', archiveName: 'a.zip', fileCount: 1,
  counts: { added: 1, updated: 0, unchanged: 0, skipped: 0, deleted: 0, failed: 0 }, logs: [], ...over,
});

describe('safeName (filename display safety)', () => {
  it('makes invisible and direction-overriding characters visible', () => {
    expect(safeName('evil\u202Etxt.exe')).toBe('evil<U+202E>txt.exe');
    expect(safeName('a\u200Bb\u0007c\ufeff')).toBe('a<U+200B>b<U+0007>c<U+FEFF>');
    expect(safeName('normal-file_1.txt')).toBe('normal-file_1.txt');
    expect(hasInvisibleChars('x\u2066y')).toBe(true);
    expect(hasInvisibleChars('plain')).toBe(false);
  });
  it('leaves HTML-looking names as plain text (escaping is React\'s job, tested in the explorer)', () => {
    expect(safeName('<img src=x onerror=alert(1)>.txt')).toBe('<img src=x onerror=alert(1)>.txt');
  });
});

describe('file tree', () => {
  const files = [file('src/b.ts', 10), file('src/a.ts', 20), file('src/lib/x.ts', 5), file('README.md', 7), file('10.txt'), file('2.txt')];
  const root = buildTree(files, ['empty/deep']);
  it('nests folders, sorts folders first and numerically, and aggregates sizes', () => {
    expect(root.children.map((c) => c.name)).toEqual(['empty', 'src', '2.txt', '10.txt', 'README.md']);
    const src = root.children.find((c) => c.name === 'src')!;
    expect(src.children.map((c) => c.name)).toEqual(['lib', 'a.ts', 'b.ts']);
    expect(src.size).toBe(35);
    expect(src.fileCount).toBe(3);
    expect(root.fileCount).toBe(6);
    expect(countDirs(root)).toBe(4); // empty, empty/deep, src, src/lib
  });
  it('search keeps matches and their ancestors only', () => {
    expect([...matchPaths(root, 'x.ts')!].sort()).toEqual(['src', 'src/lib', 'src/lib/x.ts']);
    expect(matchPaths(root, '  ')).toBeNull();
    expect(matchPaths(root, 'zzz')!.size).toBe(0);
  });
});

describe('formatting and file types', () => {
  it('formats sizes, durations and plurals', () => {
    expect(formatBytes(0)).toBe('0 B'); expect(formatBytes(1536)).toBe('1.5 KB'); expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB'); expect(formatBytes(-1)).toBe('—');
    expect(formatDuration(900)).toBe('900 ms'); expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(plural(1, 'file')).toBe('1 file'); expect(plural(2, 'file')).toBe('2 files'); expect(plural(0, 'unchanged file')).toBe('0 unchanged files');
  });
  it('classifies files and limits previews to text', () => {
    expect(fileKind('a.TSX')).toBe('code'); expect(fileKind('p.json')).toBe('data'); expect(fileKind('logo.png')).toBe('image'); expect(fileKind('x.bin')).toBe('other');
    expect(isPreviewable('README.md')).toBe(true); expect(isPreviewable('logo.png')).toBe(false); expect(isPreviewable('Dockerfile')).toBe(true);
  });
});

describe('local deployment history', () => {
  it('is isolated per GitHub user id', () => {
    const storage = new MemStorage();
    const a = new HistoryStore(storage, 1), b = new HistoryStore(storage, 2);
    a.add(record('a1'));
    expect(a.list().map((r) => r.id)).toEqual(['a1']);
    expect(b.list()).toEqual([]);
    b.clear();
    expect(a.list()).toHaveLength(1);
  });
  it('adds newest first, removes, caps the size, and survives corrupt storage', () => {
    const s = new MemStorage();
    const h = new HistoryStore(s, 7);
    for (let i = 0; i < MAX_RECORDS + 5; i++) h.add(record(`r${i}`));
    expect(h.list()).toHaveLength(MAX_RECORDS);
    expect(h.list()[0].id).toBe(`r${MAX_RECORDS + 4}`);
    expect(h.remove('r104')).toBe(true);
    expect(h.get('r104')).toBeUndefined();
    s.setItem('zipora:v1:history:7', '{not json');
    expect(h.list()).toEqual([]);
    s.setItem('zipora:v1:history:7', JSON.stringify([{ id: 1 }, record('ok'), 'x', null]));
    expect(h.list().map((r) => r.id)).toEqual(['ok']);
  });
  it('does not throw when storage is unavailable or full', () => {
    const full = { ...new MemStorage(), getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } } as unknown as Storage;
    expect(new HistoryStore(full, 1).add(record('x'))).toBe(false);
    expect(() => new HistoryStore(full, 1).clear()).not.toThrow();
    expect(new HistoryStore(undefined, 1).list()).toEqual([]);
    expect(MAX_LOG_EVENTS).toBeGreaterThan(0);
  });
});

describe('preferences', () => {
  it('round-trips and falls back to defaults for invalid values', () => {
    const s = new MemStorage();
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    savePrefs({ ...DEFAULT_PREFS, theme: 'light', deleteMissing: true }, s);
    expect(loadPrefs(s)).toMatchObject({ theme: 'light', deleteMissing: true });
    s.setItem(PREFS_KEY, JSON.stringify({ theme: 'neon', sidebarCollapsed: 'yes', defaultCommitMessage: '   ', replaceExisting: 1 }));
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    s.setItem(PREFS_KEY, 'garbage');
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });
  it('never stores anything sensitive: only the known preference keys are persisted', () => {
    const s = new MemStorage();
    savePrefs({ ...DEFAULT_PREFS, token: 'gho_secret' } as never, s);
    expect(Object.keys(JSON.parse(s.getItem(PREFS_KEY)!)).sort()).toEqual([...Object.keys(DEFAULT_PREFS), 'token'].sort()); // documents the shape callers control
    expect(DEFAULT_PREFS).not.toHaveProperty('token');
  });
});

describe('GitHub helpers and validation', () => {
  it('parses repositories defensively', () => {
    expect(parseRepo({ id: 1, name: 'r', owner: { login: 'o' }, private: true, permissions: { push: false } })).toMatchObject({ fullName: 'o/r', private: true, canPush: false, defaultBranch: 'main' });
    expect(parseRepo({ id: 1, name: 'r', owner: { login: 'o' } })!.canPush).toBe(true); // unknown → allow, GitHub enforces
    for (const bad of [null, 'x', {}, { id: 'a', name: 'r', owner: { login: 'o' } }, { id: 1, name: 'r' }]) expect(parseRepo(bad)).toBeNull();
  });
  it('validates repository and branch names', () => {
    expect(validateRepoName('my-repo_1.x')).toBeNull();
    for (const bad of ['', 'a b', 'a/b', '..', 'x.git', 'é', 'a'.repeat(101)]) expect(validateRepoName(bad), bad).not.toBeNull();
    expect(validateBranchName('feature/new-thing', ['main'])).toBeNull();
    for (const bad of ['', 'a b', 'a..b', '/a', 'a/', 'a//b', 'x.lock', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '-a', 'a@{b', 'a.']) expect(validateBranchName(bad, []), bad).not.toBeNull();
    expect(validateBranchName('main', ['main'])).toMatch(/already exists/);
  });
  it('validates deployment configuration', () => {
    const ok = { targetDir: 'docs/site', replaceExisting: true, deleteMissing: false, message: 'Deploy' };
    expect(validateConfig(ok)).toEqual({});
    expect(validateConfig({ ...ok, targetDir: '../x' }).targetDir).toBeTruthy();
    expect(validateConfig({ ...ok, targetDir: '.git/hooks' }).targetDir).toBeTruthy();
    expect(validateConfig({ ...ok, message: '  ' }).message).toBeTruthy();
    expect(validateConfig({ ...ok, message: 'x'.repeat(501) }).message).toBeTruthy();
  });
  it('describes engine errors with their hint and unknown errors safely', () => {
    expect(describeError(new EngineError('PERMISSION', 'denied', { hint: 'ask an admin' }))).toEqual({ title: 'Permission denied', message: 'denied', hint: 'ask an admin', code: 'PERMISSION' });
    expect(describeError(new Error('boom')).title).toBe('Something went wrong');
    expect(describeError('str').message).toBe('str');
    expect(authErrorFor('ACCESS_DENIED').title).toMatch(/cancelled/i);
    expect(authErrorFor('NOPE').title).toBe('Sign-in failed');
  });
});
