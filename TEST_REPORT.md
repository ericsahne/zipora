# ZIPORA engine — Phase 1 hardening report

Environment: Node + Vitest 5.1.0, Vite 8.3.8, TypeScript (strict). All results below were produced by actually running the commands.

## Results
| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| `vitest run` | **91 / 91 passed** (5 files: hardening 39, zip 11, deploy 16, github 10, paths 15) |
| `npm run build` | success, `dist/zipora-engine.js` 162.8 kB (43.0 kB gzip); built bundle loads and exports the full API |
| Mutation check | 7 deliberate regressions, each caught by the intended tests (see below) |

## Issue-by-issue

### 1. Duplicate ZIP entries
- **Reproduced first** against the previous engine: a ZIP with two entries named `aa.txt` returned `blocking: false`, zero issues, and silently kept only the second copy; file `x` + directory `x/` was not flagged.
- **Cause:** JSZip stores entries in a map keyed by name, so duplicates collapse before any check runs.
- **Fix:** new `centralDirectory.ts` reads the raw ZIP central directory (duplicates included; robust to prepended data; ZIP64 rejected, fail-closed). Collisions are computed from it. Exact duplicates, duplicates after normalisation (`a/b` vs `a\b`), case collisions and file-vs-directory-entry clashes are blocking errors. An ambiguous path is excluded from `files` instead of "last one wins".
- **Tests:** exact duplicate, normalised duplicate, file/dir entry clash, raw directory listing, prefixed + empty archives, fail-closed on damaged directory.

### 2. File/directory collisions in the engine
- New `assertDeployableFiles` runs at the start of `executeDeployment` and inside `planDeployment`: invalid/non-normalised paths, duplicates, case collisions, file-vs-directory. Failure is reported (`PATH_COLLISION` / `INVALID_PATH`) **before any network request** (asserted: `fake.calls == []`). Existing repo clashes (file/dir/submodule) were already blocked and are re-tested.
- **Tests:** 5 parametrised engine cases, exact duplicates, direct `plan`/`assert` calls, message/hint content, repo-side clashes.

### 3. Memory efficiency
- `inspectZip` now verifies each file once (CRC + Git hash), keeps only `{path,size,sha}` and returns a lazy `read()`; bytes are no longer all held. Uploads read one file at a time under a `ByteBudget` (default 64 MiB in flight; an oversize file runs alone).
- Base64: new `encodeBase64Bytes` writes into a single buffer; the blob request body is built as `Blob([prefix, base64, suffix])` — no giant string, no `JSON.stringify` copy. GitHub's returned blob SHA is verified against ours.
- **Measured** (single machine, 2 runs each; peak = OS `maxRSS` growth):

| Scenario | Old | New |
|---|---|---|
| Build request body for a 50 MB file | 309–375 MB peak, ~3.4 s | **167 MB peak**, ~0.3 s |
| Bytes retained after `inspectZip` (60 MB / 20 files, `arrayBuffers` after GC, 1 run) | ~60 MB | **~0 MB** |
| Peak RSS growth *during* `inspectZip` (same archive) | 21–28 MB | 28 MB — **no measurable difference** |

- **Not improved / still true:** the whole archive (≤100 MB) is in memory as one `Uint8Array`; a single entry is fully decompressed when read (≤100 MB); `gitBlobSha` copies the file transiently; a 100 MB file would still peak at roughly 2× the 50 MB figure (~330 MB). Streaming is not implemented.
- **Tests:** lazy-file shape, git SHA vectors (empty blob, `hello\n`) + independent Node `crypto` cross-check in every deploy test, base64 identical to `Buffer` for all padding cases and 3 MB random, binary body decodes to original, `ByteBudget` semantics, in-flight bytes ≤ budget during a real deploy, SHA-mismatch abort.

### 4. Upload concurrency and cancellation
- Found and fixed: a fatal error (e.g. 401) stopped *new* uploads but let in-flight siblings run to completion → one pool-wide `AbortController` now cancels them. Planning (hashing) checks the abort signal per file. Waiters on the memory budget wake on abort. Cancel during client backoff returns immediately (asserted < 400 ms with a 500 ms backoff).
- Cancellation is deliberately impossible once the commit step begins (a half-applied state is worse); tested: aborting at that point still yields a complete deployment.
- **Tests:** parallelism cap, sibling abort (fails by hanging if the fix is removed), cancel while planning, while queued on budget, during retry sleep, and at commit.

### 5. Retry and conflict recovery
- Found and fixed: (a) a rate limit paused only the request that hit it — now a client-wide pause is shared by all concurrent requests; (b) if a branch update succeeded but its response was lost, the retry saw a conflict and reported failure — now, after `CONFLICT`/`NETWORK`/`TIMEOUT`/`GITHUB_API` on the ref update, the engine reads the branch and reports success only if it already points at **our** commit; (c) a fixed 30 s timeout could not fit large uploads — now scales with body size (≥ ~50 KB/s assumed).
- Re-verified: 5xx/network retry with backoff and limit, 401/404/422 not retried, Retry-After honoured, long primary rate limit refused with reset time, one automatic rebase on a moved branch keeping the other pusher's files, no re-upload on retry, `no-changes` when the other push contained identical content, `CONFLICT` after retries exhausted with nothing applied, no false success when the update did not land.

### 6. Tests for every issue
39 new tests in `tests/hardening.test.ts`, grouped by issue number. **Mutation check** (each fix removed in turn; hardening suite re-run):

| Removed | Tests that failed |
|---|---|
| duplicate detection | 3 |
| pool abort on fatal error | 1 (hangs to timeout) |
| ref reconciliation | 2 |
| shared rate-limit pause | 1 |
| engine path guards | 6 |
| memory budget | 1 |
| blob SHA verification | 1 |

## NOT verified (do not treat as working)
- **Nothing was run against the real GitHub API.** All deployment tests use an in-memory fake written for this project (`tests/fakeGitHub.ts`). Real behaviour of rate-limit headers, `Retry-After` (HTTP-date form is not parsed; falls back to 60 s), updating a ref to its current SHA, error message wording, empty repositories, and the 100 MB blob limit is unconfirmed.
- Whether the shared pause and 4-way parallelism satisfy GitHub's secondary rate limits in practice.
- Browser behaviour (Blob bodies, `crypto.subtle`, Web Workers) — tests run in Node only. No Web Worker is implemented yet.
- ZIP64 handling (rejected by design, untested with a real ZIP64 file); encrypted ZIPs and unsupported compression rely on JSZip's error text and were not tested with real files; non-ASCII / non-UTF-8 entry names in duplicate detection (decoded as UTF-8).
- Memory figures are from one machine and 1–2 runs; treat as indicative.
- The partial-cancel-at-commit behaviour and the 5 s sibling-abort mutation timing depend on test timeouts, not real networks.
