import { describe, expect, it } from 'vitest';
import { EngineError, findPathCollisions, normalizeTargetDir, validateArchivePath } from '../src/engine';

describe('validateArchivePath', () => {
  it('normalises backslashes, ./ prefixes and trailing slashes', () => {
    expect(validateArchivePath('.\\src\\a.ts')).toEqual({ ok: true, path: 'src/a.ts' });
    expect(validateArchivePath('dir/')).toEqual({ ok: true, path: 'dir' });
  });
  it.each([
    ['../x', 'traversal'], ['a/../../x', 'traversal'], ['/etc/passwd', 'absolute'], ['C:\\win', 'absolute'],
    ['.git/config', '.git'], ['a/.GIT/x', '.git'], ['a//b', 'empty path segment'], ['a\u0000b', 'control'], ['', 'empty'],
  ])('rejects %j', (p, why) => {
    const r = validateArchivePath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
  it('rejects overlong paths and segments', () => {
    expect(validateArchivePath('a'.repeat(256)).ok).toBe(false);
    expect(validateArchivePath(Array(300).fill('abc').join('/')).ok).toBe(false);
  });
});

describe('normalizeTargetDir', () => {
  it('treats empty, / and . as root', () => {
    for (const d of ['', ' ', '/', '.']) expect(normalizeTargetDir(d)).toBe('');
  });
  it('rejects unsafe directories with a hint', () => {
    expect(() => normalizeTargetDir('../x')).toThrow(EngineError);
  });
});

describe('findPathCollisions', () => {
  it('detects exact duplicates, case collisions and file/dir conflicts', () => {
    const codes = findPathCollisions(['a.txt', 'a.txt', 'B.txt', 'b.txt', 'x', 'x/y']).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DUPLICATE_PATH', 'CASE_COLLISION', 'FILE_DIRECTORY_CONFLICT']));
  });
  it('returns nothing for clean input', () => {
    expect(findPathCollisions(['a', 'b/c', 'b/d'])).toEqual([]);
  });
});
