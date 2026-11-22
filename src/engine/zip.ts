import JSZip from 'jszip';
import { readCentralDirectory } from './centralDirectory';
import { EngineError } from './errors';
import { crc32, gitBlobSha } from './hash';
import { findPathCollisions, validateArchivePath } from './paths';
import type { Issue, SourceFile, ZipLimits } from './types';

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: ZipLimits = {
  maxArchiveBytes: 100 * MB,
  maxFiles: 5000,
  maxTotalBytes: 500 * MB,
  maxFileBytes: 100 * MB, // GitHub rejects blobs above 100 MiB
  maxCompressionRatio: 200,
};

export interface InspectOptions {
  limits?: Partial<ZipLimits>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ZipInspection {
  /** Lazy files: each is verified once during inspection, then re-read on demand (never all held in memory). */
  files: SourceFile[];
  /** Empty directories cannot be stored in Git; they are reported, never silently dropped. */
  emptyDirs: string[];
  issues: Issue[];
  totalBytes: number;
  /** True when any error-level issue means the archive must not be deployed as-is. */
  blocking: boolean;
}

interface EntryInternals {
  _data?: { uncompressedSize?: number; compressedSize?: number; crc32?: number };
  unsafeOriginalName?: string;
}
interface Candidate { entry: JSZip.JSZipObject; path: string; crc?: number }

const isZipSignature = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));

const cancelled = () => new EngineError('CANCELLED', 'Operation cancelled.');
const isJunk = (p: string) => p.startsWith('__MACOSX/') || p === '.DS_Store' || p.endsWith('/.DS_Store');

/** Decompresses one entry and verifies its CRC. Throws CORRUPTED_ZIP on any mismatch. */
async function extract(c: Candidate): Promise<Uint8Array> {
  let data: Uint8Array;
  try {
    data = await c.entry.async('uint8array');
  } catch (e) {
    throw new EngineError('CORRUPTED_ZIP', `"${c.path}" could not be extracted (${e instanceof Error ? e.message : e}).`, {
      hint: 'The archive is damaged. Create the ZIP again.', cause: e,
    });
  }
  if (c.crc !== undefined && crc32(data) !== c.crc >>> 0) {
    throw new EngineError('CORRUPTED_ZIP', `"${c.path}" failed its integrity check (CRC mismatch).`, {
      hint: 'The archive is damaged. Download or create it again.',
    });
  }
  return data;
}

export async function inspectZip(input: Uint8Array, options: InspectOptions = {}): Promise<ZipInspection> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const { signal } = options;

  if (input.byteLength === 0) {
    throw new EngineError('INVALID_ZIP', 'The file is empty.', { hint: 'Choose a non-empty .zip archive.' });
  }
  if (input.byteLength > limits.maxArchiveBytes) {
    throw new EngineError('ARCHIVE_TOO_LARGE', `Archive is ${(input.byteLength / MB).toFixed(1)} MB; the limit is ${(limits.maxArchiveBytes / MB).toFixed(0)} MB.`, {
      hint: 'Split the project into several smaller archives and deploy them one at a time.',
    });
  }
  if (!isZipSignature(input)) {
    throw new EngineError('INVALID_ZIP', 'This is not a ZIP archive.', {
      hint: 'Only .zip files are supported. Re-create the archive with a standard ZIP tool (7z, tar is not supported).',
    });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypted/i.test(msg)) {
      throw new EngineError('ENCRYPTED_ZIP', 'The archive is password-protected.', { hint: 'Remove the password and create the ZIP again.', cause: e });
    }
    if (/not supported|compression/i.test(msg)) {
      throw new EngineError('UNSUPPORTED_COMPRESSION', 'The archive uses an unsupported compression method.', {
        hint: 'Re-create the ZIP using the standard "Deflate" or "Store" method.', cause: e,
      });
    }
    throw new EngineError('CORRUPTED_ZIP', `The archive is damaged and cannot be read (${msg}).`, {
      hint: 'Download or create the ZIP again. If it was transferred, check that the upload finished.', cause: e,
    });
  }

  // JSZip collapses entries that share a name, so duplicates must be found in the raw directory.
  const directory = readCentralDirectory(input);
  const dirFileCount = directory.filter((e) => !e.isDir).length;
  if (dirFileCount > limits.maxFiles) {
    throw new EngineError('TOO_MANY_FILES', `Archive has ${dirFileCount} files; the limit is ${limits.maxFiles}.`, {
      hint: 'Deploy in several smaller archives, or exclude generated folders such as node_modules.',
    });
  }
  const cdFiles: string[] = [];
  const cdDirs: string[] = [];
  for (const e of directory) {
    const c = validateArchivePath(e.name);
    if (!c.ok || isJunk(c.path)) continue; // reported by the pass below
    (e.isDir ? cdDirs : cdFiles).push(c.path);
  }
  const collisions = findPathCollisions(cdFiles, cdDirs);
  // An ambiguous path is never deployed: which duplicate "wins" would be arbitrary.
  const ambiguous = new Set(collisions.filter((i) => i.code === 'DUPLICATE_PATH').map((i) => i.path));

  const issues: Issue[] = [];
  const dirPaths: string[] = [];
  const candidates: Candidate[] = [];
  let declaredTotal = 0;

  for (const entry of Object.values(zip.files)) {
    // JSZip collapses ".." in `name`; validate the original name from the archive.
    const internals = entry as unknown as EntryInternals;
    const rawName = internals.unsafeOriginalName ?? entry.name;
    const check = validateArchivePath(rawName);
    if (!check.ok) {
      issues.push({ severity: 'error', code: 'INVALID_PATH', path: rawName, message: `"${rawName}" ${check.reason}.` });
      continue;
    }
    if (isJunk(check.path)) {
      issues.push({ severity: 'warning', code: 'SKIPPED_JUNK', path: check.path, message: `Skipped OS metadata file "${check.path}".` });
      continue;
    }
    if (entry.dir) {
      dirPaths.push(check.path);
      continue;
    }
    if (ambiguous.has(check.path)) continue; // already reported as DUPLICATE_PATH
    const mode = entry.unixPermissions;
    if (typeof mode === 'number' && (mode & 0o170000) === 0o120000) {
      issues.push({ severity: 'error', code: 'SYMLINK', path: check.path, message: `"${check.path}" is a symbolic link, which cannot be deployed safely.` });
      continue;
    }
    const meta = internals._data ?? {};
    const size = meta.uncompressedSize ?? 0;
    const packed = meta.compressedSize ?? 0;
    if (size > limits.maxFileBytes) {
      throw new EngineError('FILE_TOO_LARGE', `"${check.path}" is ${(size / MB).toFixed(1)} MB; the per-file limit is ${(limits.maxFileBytes / MB).toFixed(0)} MB.`, {
        hint: 'GitHub rejects files over 100 MB. Remove the file or use Git LFS outside of ZIPORA.',
      });
    }
    if (size > 10 * MB && packed > 0 && size / packed > limits.maxCompressionRatio) {
      throw new EngineError('COMPRESSION_RATIO', `"${check.path}" has a suspicious compression ratio (${Math.round(size / packed)}:1).`, {
        hint: 'This can indicate a decompression bomb. Re-create the archive from trusted files.',
      });
    }
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) {
      throw new EngineError('EXTRACTED_TOO_LARGE', `Extracted size exceeds ${(limits.maxTotalBytes / MB).toFixed(0)} MB.`, { hint: 'Deploy fewer files per archive.' });
    }
    candidates.push({ entry, path: check.path, crc: meta.crc32 });
  }

  // Verify every file once and keep only its size and hash; the bytes are released immediately.
  const files: SourceFile[] = [];
  let totalBytes = 0;
  for (const c of candidates) {
    if (signal?.aborted) throw cancelled();
    const data = await extract(c);
    totalBytes += data.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new EngineError('EXTRACTED_TOO_LARGE', `Extracted size exceeds ${(limits.maxTotalBytes / MB).toFixed(0)} MB.`, { hint: 'Deploy fewer files per archive.' });
    }
    const size = data.byteLength;
    const sha = await gitBlobSha(data);
    files.push({
      path: c.path, size, sha,
      read: async () => {
        const again = await extract(c);
        if (again.byteLength !== size) {
          throw new EngineError('CORRUPTED_ZIP', `"${c.path}" changed size between reads.`, { hint: 'The archive is damaged. Create the ZIP again.' });
        }
        return again;
      },
    });
    options.onProgress?.(files.length, candidates.length);
  }

  const ancestors = new Set<string>();
  for (const f of files) {
    for (let i = f.path.indexOf('/'); i !== -1; i = f.path.indexOf('/', i + 1)) ancestors.add(f.path.slice(0, i));
  }
  const emptyDirs = dirPaths.filter((d) => !ancestors.has(d));
  for (const d of emptyDirs) {
    issues.push({ severity: 'warning', code: 'EMPTY_DIR', path: d, message: `Empty directory "${d}" will not be deployed (Git cannot store empty folders).` });
  }
  issues.push(...collisions);

  return { files, emptyDirs, issues, totalBytes, blocking: issues.some((i) => i.severity === 'error') };
}
