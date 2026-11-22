export type EngineErrorCode =
  | 'INVALID_ZIP' | 'CORRUPTED_ZIP' | 'ENCRYPTED_ZIP' | 'UNSUPPORTED_COMPRESSION'
  | 'ARCHIVE_TOO_LARGE' | 'FILE_TOO_LARGE' | 'TOO_MANY_FILES' | 'EXTRACTED_TOO_LARGE'
  | 'COMPRESSION_RATIO' | 'INVALID_PATH' | 'PATH_COLLISION'
  | 'AUTH' | 'PERMISSION' | 'NOT_FOUND' | 'RATE_LIMIT' | 'NETWORK' | 'TIMEOUT'
  | 'CONFLICT' | 'GITHUB_API' | 'TREE_TRUNCATED' | 'UPLOAD_FAILED' | 'BLOCKED' | 'CANCELLED';

export interface EngineErrorOptions {
  hint?: string;
  recoverable?: boolean;
  status?: number;
  resetAt?: number;
  cause?: unknown;
}

/** Every failure the engine reports carries a stable code and a recovery hint. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly hint?: string;
  readonly recoverable: boolean;
  readonly status?: number;
  readonly resetAt?: number;

  constructor(code: EngineErrorCode, message: string, options: EngineErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'EngineError';
    this.code = code;
    this.hint = options.hint;
    this.recoverable = options.recoverable ?? false;
    this.status = options.status;
    this.resetAt = options.resetAt;
  }
}

export function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  return new EngineError('GITHUB_API', e instanceof Error ? e.message : String(e), { cause: e });
}
