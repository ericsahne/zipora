import { ByteBudget } from './budget';
import { EngineError, toEngineError } from './errors';
import type { GitHubClient, NewTreeEntry } from './github';
import { gitBlobSha } from './hash';
import { findPathCollisions, normalizeTargetDir, validateArchivePath } from './paths';
import type { Issue, SourceFile, TreeEntry } from './types';

export const TREE_CHUNK = 500;
export const DEFAULT_MAX_INFLIGHT_BYTES = 64 * 1024 * 1024;
const WARN_FILE_BYTES = 50 * 1024 * 1024;

export interface DeployTarget { owner: string; repo: string; branch: string }

export interface DeployOptions {
  /** Directory inside the repo ('' = root). Deletions never reach outside it. */
  targetDir: string;
  replaceExisting: boolean;
  /** Delete files under targetDir that are not in the archive. Off unless explicitly requested. */
  deleteMissing: boolean;
  message: string;
  /** If the target branch does not exist, create it from this branch. */
  createBranchFrom?: string;
}

export interface PlannedFile { path: string; file: SourceFile; sha: string; mode: string }

export interface DeployPlan {
  add: PlannedFile[];
  update: PlannedFile[];
  unchanged: string[];
  skippedExisting: string[];
  delete: string[];
  warnings: string[];
}

export type Stage = 'connecting' | 'preparing' | 'processing' | 'tree' | 'commit' | 'branch' | 'complete';

export interface DeployEvent {
  time: string;
  stage: Stage;
  level: 'info' | 'warn' | 'error';
  message: string;
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface DeployResult {
  status: 'success' | 'no-changes' | 'failed' | 'cancelled';
  commitSha?: string;
  commitUrl?: string;
  error?: EngineError;
  counts: { added: number; updated: number; unchanged: number; skipped: number; deleted: number; failed: number };
  logs: DeployEvent[];
}

export interface DeployParams {
  client: GitHubClient;
  target: DeployTarget;
  files: readonly SourceFile[];
  options: DeployOptions;
  signal?: AbortSignal;
  onEvent?: (e: DeployEvent) => void;
  /** Parallel uploads (default 4). */
  concurrency?: number;
  /** Upper bound on file bytes held in memory by uploads at once (default 64 MiB). */
  maxInflightBytes?: number;
  maxConflictRetries?: number;
}

export function formatLogs(logs: DeployEvent[]): string {
  return logs.map((l) => `${l.time} [${l.level.toUpperCase()}] ${l.stage}: ${l.message}`).join('\n');
}

/**
 * Engine-level guard, independent of how the files were produced: rejects invalid or non-normalised
 * paths, duplicates, case collisions and file/directory clashes before anything touches the network.
 */
export function assertDeployableFiles(files: readonly { path: string }[]): void {
  const issues: Issue[] = [];
  for (const f of files) {
    const c = validateArchivePath(f.path);
    if (!c.ok) issues.push({ severity: 'error', code: 'INVALID_PATH', path: f.path, message: `"${f.path}" ${c.reason}.` });
    else if (c.path !== f.path) issues.push({ severity: 'error', code: 'INVALID_PATH', path: f.path, message: `"${f.path}" is not normalised (expected "${c.path}").` });
  }
  issues.push(...findPathCollisions(files.map((f) => f.path)));
  if (issues.length === 0) return;
  const code = issues.some((i) => i.code === 'INVALID_PATH') ? 'INVALID_PATH' : 'PATH_COLLISION';
  const shown = issues.slice(0, 5).map((i) => i.message).join(' ');
  throw new EngineError(code, `${issues.length} path problem(s) block deployment: ${shown}${issues.length > 5 ? ' …' : ''}`, {
    hint: 'Fix or remove the conflicting entries and create the ZIP again. Nothing was sent to GitHub.',
  });
}

const cancelled = () => new EngineError('CANCELLED', 'Deployment cancelled before any commit was created.');

/** Compares the archive against the repository tree. Reads files one at a time, and only when their hash is unknown. */
export async function planDeployment(
  files: readonly SourceFile[],
  existing: TreeEntry[],
  opts: Pick<DeployOptions, 'targetDir' | 'replaceExisting' | 'deleteMissing'>,
  signal?: AbortSignal,
): Promise<DeployPlan> {
  assertDeployableFiles(files);
  const dir = normalizeTargetDir(opts.targetDir);
  const byPath = new Map(existing.map((e) => [e.path, e]));
  const blobPaths = new Set(existing.filter((e) => e.type === 'blob').map((e) => e.path));
  const plan: DeployPlan = { add: [], update: [], unchanged: [], skippedExisting: [], delete: [], warnings: [] };
  const newPaths = new Set<string>();

  for (const file of files) {
    if (signal?.aborted) throw cancelled();
    const path = dir ? `${dir}/${file.path}` : file.path;
    const check = validateArchivePath(path);
    if (!check.ok) throw new EngineError('INVALID_PATH', `"${path}" ${check.reason}.`);
    newPaths.add(path);
    const ex = byPath.get(path);
    if (ex && ex.type !== 'blob') {
      throw new EngineError('BLOCKED', `"${path}" exists in the repository as a ${ex.type === 'tree' ? 'directory' : 'submodule'}.`, {
        hint: 'Choose a different target directory or remove that path from the repository first.',
      });
    }
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
      if (blobPaths.has(path.slice(0, i))) {
        throw new EngineError('BLOCKED', `"${path.slice(0, i)}" is a file in the repository but "${path}" needs it to be a directory.`, {
          hint: 'Choose a different target directory.',
        });
      }
    }
    if (file.size > WARN_FILE_BYTES) plan.warnings.push(`"${path}" is over 50 MB; GitHub recommends keeping files well below 100 MB.`);
    const sha = file.sha ?? (await gitBlobSha(await file.read()));
    const planned: PlannedFile = { path, file, sha, mode: ex?.mode === '100755' ? '100755' : '100644' };
    if (!ex) plan.add.push(planned);
    else if (ex.sha === sha) plan.unchanged.push(path);
    else if (opts.replaceExisting) plan.update.push(planned);
    else plan.skippedExisting.push(path);
  }

  if (opts.deleteMissing) {
    for (const e of existing) {
      const inDir = dir === '' || e.path.startsWith(dir + '/');
      if (e.type === 'blob' && inDir && !newPaths.has(e.path)) plan.delete.push(e.path);
    }
  }
  return plan;
}

// Errors where continuing to upload is pointless (or harmful): stop everything immediately.
const FATAL_UPLOAD = new Set(['AUTH', 'PERMISSION', 'RATE_LIMIT', 'NOT_FOUND', 'CORRUPTED_ZIP']);
// A failed ref update with one of these codes may still have landed on GitHub; verify before reporting failure.
const RECONCILE = new Set(['CONFLICT', 'NETWORK', 'TIMEOUT', 'GITHUB_API']);

/**
 * Blobs -> trees -> one commit -> fast-forward ref update. Nothing is visible on the branch until the
 * final ref update, so any earlier failure or cancellation leaves the repository untouched.
 */
export async function executeDeployment(p: DeployParams): Promise<DeployResult> {
  const { client, target, options, signal } = p;
  const { owner, repo, branch } = target;
  const logs: DeployEvent[] = [];
  const state = { processed: 0, total: 0, succeeded: 0, failed: 0 };
  const counts = { added: 0, updated: 0, unchanged: 0, skipped: 0, deleted: 0, failed: 0 };
  const uploaded = new Set<string>();

  const emit = (stage: Stage, level: DeployEvent['level'], message: string) => {
    const ev: DeployEvent = { time: new Date().toISOString(), stage, level, message, ...state };
    logs.push(ev);
    p.onEvent?.(ev);
  };

  async function uploadAll(toUpload: PlannedFile[]): Promise<void> {
    const pending = toUpload.filter((f) => !uploaded.has(f.sha));
    state.total = toUpload.length;
    state.processed = state.succeeded = toUpload.length - pending.length;
    emit('processing', 'info', `Uploading ${pending.length} file(s)`);

    // One controller for the whole pool: external cancel OR a fatal error aborts every in-flight request.
    const pool = new AbortController();
    const onExternalAbort = () => pool.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (signal?.aborted) pool.abort();
    const budget = new ByteBudget(p.maxInflightBytes ?? DEFAULT_MAX_INFLIGHT_BYTES);
    const failedPaths: string[] = [];
    let fatal: EngineError | undefined;
    let next = 0;

    const worker = async () => {
      while (!fatal && !pool.signal.aborted) {
        const f = pending[next++];
        if (!f) return;
        try {
          await budget.acquire(f.file.size, pool.signal);
        } catch {
          return; // cancelled while waiting for memory budget
        }
        try {
          const data = await f.file.read();
          const sha = await client.createBlob(owner, repo, data, pool.signal);
          if (sha !== f.sha) {
            throw new EngineError('UPLOAD_FAILED', `GitHub stored "${f.path}" with a different hash (${sha.slice(0, 7)} vs ${f.sha.slice(0, 7)}).`, { recoverable: true });
          }
          uploaded.add(f.sha);
          state.succeeded++;
        } catch (e) {
          const err = toEngineError(e);
          if (err.code === 'CANCELLED') return;
          state.failed++;
          failedPaths.push(f.path);
          emit('processing', 'error', `Failed to upload ${f.path}: ${err.message}`);
          if (FATAL_UPLOAD.has(err.code)) {
            fatal = err;
            pool.abort(); // stop sibling uploads instead of letting them run to completion
          }
        } finally {
          budget.release(f.file.size);
          state.processed++;
        }
        if (state.processed % 25 === 0 || state.processed === state.total) emit('processing', 'info', `Processed ${state.processed}/${state.total}`);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(p.concurrency ?? 4, pending.length) }, worker));
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
    }
    if (signal?.aborted) throw cancelled();
    if (fatal) throw fatal;
    if (failedPaths.length > 0) {
      counts.failed = failedPaths.length;
      throw new EngineError('UPLOAD_FAILED', `${failedPaths.length} file(s) failed to upload after retries. No commit was created and the branch is unchanged.`, {
        recoverable: true, hint: `Retry the deployment; uploads are idempotent. First failure: ${failedPaths[0]}`,
      });
    }
  }

  async function runOnce(): Promise<DeployResult> {
    state.processed = state.total = state.succeeded = state.failed = 0;
    emit('connecting', 'info', `Reading ${owner}/${repo}@${branch}`);
    let head;
    let creating = false;
    try {
      head = await client.getBranch(owner, repo, branch, signal);
    } catch (e) {
      const err = toEngineError(e);
      if (err.code === 'NOT_FOUND' && options.createBranchFrom) {
        head = await client.getBranch(owner, repo, options.createBranchFrom, signal);
        creating = true;
        emit('connecting', 'info', `Branch "${branch}" does not exist; it will be created from "${options.createBranchFrom}".`);
      } else {
        throw err;
      }
    }

    emit('preparing', 'info', 'Reading repository file tree');
    const { entries, truncated } = await client.getTree(owner, repo, head.treeSha, signal);
    if (truncated) {
      throw new EngineError('TREE_TRUNCATED', 'This repository is too large for GitHub to list in one request, so files cannot be compared safely.', {
        hint: 'Deploy into a smaller repository or branch. ZIPORA will not guess and risk overwriting existing files.',
      });
    }
    const plan = await planDeployment(p.files, entries, options, signal);
    for (const w of plan.warnings) emit('preparing', 'warn', w);
    for (const s of plan.skippedExisting) emit('preparing', 'warn', `Skipped existing file (replace is off): ${s}`);
    counts.unchanged = plan.unchanged.length;
    counts.skipped = plan.skippedExisting.length;
    emit('preparing', 'info', `Plan: ${plan.add.length} new, ${plan.update.length} changed, ${plan.unchanged.length} unchanged, ${plan.delete.length} to delete`);

    const toUpload = [...plan.add, ...plan.update];
    if (toUpload.length === 0 && plan.delete.length === 0) {
      if (!creating) {
        emit('complete', 'info', 'Repository already matches the archive; no commit created.');
        return { status: 'no-changes', counts, logs };
      }
      await client.createRef(owner, repo, branch, head.commitSha, signal);
      emit('complete', 'info', `Created branch "${branch}" with no file changes.`);
      return { status: 'no-changes', commitSha: head.commitSha, counts, logs };
    }

    await uploadAll(toUpload);

    // Staged tree creation: intermediate trees are unreferenced, so the deployment stays atomic.
    const changes: NewTreeEntry[] = [
      ...toUpload.map((f) => ({ path: f.path, mode: f.mode, type: 'blob' as const, sha: f.sha })),
      ...plan.delete.map((path) => ({ path, mode: '100644', type: 'blob' as const, sha: null })),
    ];
    let tree = head.treeSha;
    for (let i = 0; i < changes.length; i += TREE_CHUNK) {
      if (signal?.aborted) throw cancelled();
      tree = await client.createTree(owner, repo, { baseTree: tree, tree: changes.slice(i, i + TREE_CHUNK) }, signal);
      emit('tree', 'info', `Created tree ${Math.min(i + TREE_CHUNK, changes.length)}/${changes.length} entries`);
    }

    if (signal?.aborted) throw cancelled();
    emit('commit', 'info', 'Creating commit (cancellation is no longer possible)');
    const commitSha = await client.createCommit(owner, repo, { message: options.message, tree, parents: [head.commitSha] });

    emit('branch', 'info', creating ? `Creating branch "${branch}"` : `Updating "${branch}" (fast-forward only)`);
    try {
      if (creating) await client.createRef(owner, repo, branch, commitSha);
      else await client.updateRef(owner, repo, branch, commitSha);
    } catch (e) {
      const err = toEngineError(e);
      if (!RECONCILE.has(err.code)) throw err;
      // The request may have succeeded even though its response was lost, or its retry then saw a conflict.
      const landed = await client.getBranch(owner, repo, branch).then((h) => h.commitSha === commitSha, () => false);
      if (!landed) throw err;
      emit('branch', 'warn', `GitHub reported "${err.code}" but "${branch}" already points at our commit; treating the update as successful.`);
    }

    counts.added = plan.add.length;
    counts.updated = plan.update.length;
    counts.deleted = plan.delete.length;
    const commitUrl = `https://github.com/${owner}/${repo}/commit/${commitSha}`;
    emit('complete', 'info', `Deployed commit ${commitSha.slice(0, 7)}: ${commitUrl}`);
    return { status: 'success', commitSha, commitUrl, counts, logs };
  }

  try {
    if (!options.message.trim()) throw new EngineError('BLOCKED', 'A commit message is required.');
    if (p.files.length === 0 && !options.deleteMissing) throw new EngineError('BLOCKED', 'There are no files to deploy.');
    assertDeployableFiles(p.files);
    normalizeTargetDir(options.targetDir);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw cancelled();
      try {
        return await runOnce();
      } catch (e) {
        const err = toEngineError(e);
        if (err.code === 'CONFLICT' && attempt < (p.maxConflictRetries ?? 1)) {
          emit('branch', 'warn', 'Branch moved during deployment; re-planning against the latest commit.');
          continue;
        }
        throw err;
      }
    }
  } catch (e) {
    const error = toEngineError(e);
    emit('complete', 'error', `${error.message}${error.hint ? ` — ${error.hint}` : ''}`);
    return { status: error.code === 'CANCELLED' ? 'cancelled' : 'failed', error, counts, logs };
  }
}
