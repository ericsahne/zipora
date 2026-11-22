import { EngineError, type EngineErrorCode } from '../engine';

export interface Described { title: string; message: string; hint?: string; code?: string }

const TITLES: Partial<Record<EngineErrorCode, string>> = {
  INVALID_ZIP: 'Not a valid ZIP archive', CORRUPTED_ZIP: 'The archive is damaged', ENCRYPTED_ZIP: 'Password-protected archive',
  UNSUPPORTED_COMPRESSION: 'Unsupported compression', ARCHIVE_TOO_LARGE: 'Archive is too large', FILE_TOO_LARGE: 'A file is too large',
  TOO_MANY_FILES: 'Too many files', EXTRACTED_TOO_LARGE: 'Extracted content is too large', COMPRESSION_RATIO: 'Suspicious archive',
  INVALID_PATH: 'Invalid path', PATH_COLLISION: 'Conflicting paths', AUTH: 'GitHub sign-in required', PERMISSION: 'Permission denied',
  NOT_FOUND: 'Not found', RATE_LIMIT: 'GitHub rate limit reached', NETWORK: 'Network problem', TIMEOUT: 'GitHub did not respond',
  CONFLICT: 'Branch changed during deployment', GITHUB_API: 'GitHub rejected the request', TREE_TRUNCATED: 'Repository too large to compare',
  UPLOAD_FAILED: 'Some files failed to upload', BLOCKED: 'Deployment blocked', CANCELLED: 'Cancelled',
};

/** What each failure means and what to do — rendered in the documentation, so it cannot drift from the app. */
export const ERROR_GUIDE: Array<{ code: EngineErrorCode; cause: string; fix: string }> = [
  { code: 'INVALID_ZIP', cause: 'The file is empty or is not a ZIP archive.', fix: 'Create a standard .zip (not .rar, .7z or .tar) and add it again.' },
  { code: 'CORRUPTED_ZIP', cause: 'The archive is damaged or failed its integrity check.', fix: 'Download or create the ZIP again; check the transfer finished.' },
  { code: 'ENCRYPTED_ZIP', cause: 'The archive is password-protected.', fix: 'Remove the password and create the ZIP again.' },
  { code: 'UNSUPPORTED_COMPRESSION', cause: 'The archive uses a compression method other than Deflate or Store.', fix: 'Re-create the ZIP with a standard tool.' },
  { code: 'ARCHIVE_TOO_LARGE', cause: 'The archive is larger than the archive limit.', fix: 'Split the project into several smaller archives.' },
  { code: 'FILE_TOO_LARGE', cause: 'One file is larger than the per-file limit (GitHub itself refuses files over 100 MB).', fix: 'Remove or shrink that file; use Git LFS outside ZIPORA for large assets.' },
  { code: 'TOO_MANY_FILES', cause: 'The archive has more files than the limit.', fix: 'Exclude generated folders such as node_modules, or split the archive.' },
  { code: 'EXTRACTED_TOO_LARGE', cause: 'The unpacked size is above the limit.', fix: 'Deploy fewer files per archive.' },
  { code: 'COMPRESSION_RATIO', cause: 'A file expands to an implausible size (possible decompression bomb).', fix: 'Re-create the archive from trusted files.' },
  { code: 'INVALID_PATH', cause: 'An entry path is unsafe (.., absolute, .git, control characters) or the target folder is invalid.', fix: 'Fix or remove the entry and re-create the ZIP; use a relative target folder.' },
  { code: 'PATH_COLLISION', cause: 'Two entries share a path, differ only by letter case, or one is both a file and a folder.', fix: 'Rename or remove the conflicting entries.' },
  { code: 'AUTH', cause: 'GitHub rejected the access token (expired or revoked).', fix: 'Sign in again.' },
  { code: 'PERMISSION', cause: 'GitHub denied access to the repository or action.', fix: 'Check you can push to the repository; organization repos may need an owner to approve ZIPORA.' },
  { code: 'NOT_FOUND', cause: 'The repository or branch does not exist, or your token cannot see it.', fix: 'Check the names; refresh the repository list.' },
  { code: 'RATE_LIMIT', cause: 'GitHub is limiting requests.', fix: 'Wait until the reset time shown, then retry. Nothing was committed.' },
  { code: 'NETWORK', cause: 'The connection to GitHub failed.', fix: 'Check your connection and retry.' },
  { code: 'TIMEOUT', cause: 'GitHub did not answer in time.', fix: 'Retry; on a slow connection try fewer or smaller files.' },
  { code: 'CONFLICT', cause: 'The branch moved while you deployed.', fix: 'Run the deployment again; ZIPORA already retried once.' },
  { code: 'GITHUB_API', cause: 'GitHub rejected a request (including temporary GitHub outages).', fix: 'Read the message; retry in a minute if GitHub reports a server error.' },
  { code: 'TREE_TRUNCATED', cause: 'The repository is too large for GitHub to list in one request.', fix: 'Deploy into a smaller repository or branch.' },
  { code: 'UPLOAD_FAILED', cause: 'Some files could not be uploaded after retries.', fix: 'Retry; no commit was created, so the branch is unchanged.' },
  { code: 'BLOCKED', cause: 'The deployment is not allowed as configured (e.g. file/folder clash with the repository, empty message).', fix: 'Change the target folder or remove the clashing path.' },
  { code: 'CANCELLED', cause: 'You cancelled before the commit started.', fix: 'Nothing was committed. Deploy again when ready.' },
];

export function describeError(e: unknown): Described {
  if (e instanceof EngineError) return { title: TITLES[e.code] ?? 'Something went wrong', message: e.message, hint: e.hint, code: e.code };
  if (e instanceof Error) return { title: 'Something went wrong', message: e.message };
  return { title: 'Something went wrong', message: String(e) };
}

/** Messages for the ?auth_error=CODE values the OAuth callback redirects with. */
export const AUTH_ERRORS: Record<string, { title: string; message: string }> = {
  OAUTH_STATE_INVALID: { title: 'Sign-in could not be verified', message: 'The sign-in attempt expired or did not start from this browser. Please try again.' },
  ACCESS_DENIED: { title: 'Authorization was cancelled', message: 'ZIPORA needs your approval on GitHub to read your repositories and commit your files.' },
  INSUFFICIENT_SCOPE: { title: 'Missing permissions', message: 'GitHub did not grant the repository access ZIPORA needs. Approve the requested permissions and try again.' },
  OAUTH_MISCONFIGURED: { title: 'Sign-in is misconfigured', message: 'The server\u2019s GitHub OAuth settings are wrong. This needs to be fixed by whoever runs this ZIPORA instance.' },
  GITHUB_UNREACHABLE: { title: 'GitHub is unreachable', message: 'Could not reach GitHub. Check your connection and try again.' },
  INVALID_CODE: { title: 'Sign-in code rejected', message: 'GitHub rejected the sign-in code. Please start again.' },
  OAUTH_CODE_MISSING: { title: 'Sign-in incomplete', message: 'GitHub did not return a sign-in code. Please start again.' },
  TOKEN_INVALID: { title: 'GitHub rejected the access token', message: 'Please sign in again.' },
  GITHUB_FORBIDDEN: { title: 'GitHub refused the request', message: 'GitHub may be rate limiting this app. Try again shortly.' },
  OAUTH_ERROR: { title: 'GitHub reported an error', message: 'Something went wrong on GitHub\u2019s side. Please try again.' },
  INTERNAL: { title: 'Unexpected server error', message: 'Please try again in a moment.' },
};
export const authErrorFor = (code: string) => AUTH_ERRORS[code] ?? { title: 'Sign-in failed', message: 'Please try again.' };
