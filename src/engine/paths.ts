import { EngineError } from './errors';
import type { Issue } from './types';

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };
const bad = (reason: string): PathCheck => ({ ok: false, reason });

/** Validates and normalises an archive entry path. Never throws; callers report `reason`. */
export function validateArchivePath(raw: string): PathCheck {
  if (/[\u0000-\u001f\u007f]/.test(raw)) return bad('contains control characters');
  const p = raw.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return bad('is an absolute path');
  const segs: string[] = [];
  for (const s of p.replace(/\/+$/, '').split('/')) {
    if (s === '.') continue;
    if (s === '..') return bad('contains ".." (path traversal)');
    if (s === '') return bad('contains an empty path segment');
    if (s.length > MAX_SEGMENT_LENGTH) return bad(`has a segment longer than ${MAX_SEGMENT_LENGTH} characters`);
    if (s.toLowerCase() === '.git') return bad('targets a .git directory');
    segs.push(s);
  }
  if (segs.length === 0) return bad('is empty');
  const path = segs.join('/');
  if (path.length > MAX_PATH_LENGTH) return bad(`is longer than ${MAX_PATH_LENGTH} characters`);
  return { ok: true, path };
}

/** Returns '' for the repository root, otherwise a validated directory path. */
export function normalizeTargetDir(dir: string): string {
  const t = dir.trim();
  if (t === '' || t === '/' || t === '.') return '';
  const check = validateArchivePath(t);
  if (!check.ok) {
    throw new EngineError('INVALID_PATH', `Target directory "${dir}" ${check.reason}.`, {
      hint: 'Use a relative folder such as "docs" or "apps/site", or leave it empty for the repository root.',
    });
  }
  return check.path;
}

/** `dirs` are explicit directory entries; a directory sharing a name with a file is a conflict. */
export function findPathCollisions(paths: readonly string[], dirs: readonly string[] = []): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const lower = new Map<string, string>();
  for (const p of paths) {
    if (seen.has(p)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_PATH', path: p, message: `"${p}" appears more than once in the archive.` });
    }
    seen.add(p);
    const l = p.toLowerCase();
    const prev = lower.get(l);
    if (prev !== undefined && prev !== p) {
      issues.push({
        severity: 'error', code: 'CASE_COLLISION', path: p,
        message: `"${p}" and "${prev}" differ only by letter case and would collide on case-insensitive systems.`,
      });
    }
    lower.set(l, p);
  }
  for (const p of seen) {
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
      const prefix = p.slice(0, i);
      if (seen.has(prefix)) {
        issues.push({
          severity: 'error', code: 'FILE_DIRECTORY_CONFLICT', path: p,
          message: `"${prefix}" is a file but "${p}" needs it to be a directory.`,
        });
      }
    }
  }
  for (const d of new Set(dirs)) {
    if (seen.has(d)) {
      issues.push({ severity: 'error', code: 'FILE_DIRECTORY_CONFLICT', path: d, message: `"${d}" is both a file and a directory in the archive.` });
    }
  }
  return issues;
}
