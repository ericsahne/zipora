/**
 * A file to deploy. Content is read on demand so a large archive is never fully decompressed in memory.
 * `path` must already be normalised (see validateArchivePath).
 */
export interface SourceFile {
  path: string;
  size: number;
  /** Git blob SHA-1 when already known (ZIP inspection computes it); otherwise computed from read(). */
  sha?: string;
  read(): Promise<Uint8Array>;
}

export const bytesFile = (path: string, data: Uint8Array): SourceFile => ({ path, size: data.byteLength, read: async () => data });

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ZipLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  /** Declared uncompressed/compressed ratio above which large entries are rejected (zip-bomb guard). */
  maxCompressionRatio: number;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}
