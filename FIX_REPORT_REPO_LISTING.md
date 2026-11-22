# Fix report — repository listing / NOT_FOUND

## Summary (read this first)
- **I could not reproduce your exact failure against your real GitHub account or Vercel deployment**, so I cannot tell you for certain which cause applies to you. What I could do — and did — is reproduce the *symptom* with the current code, find the defect in ZIPORA that hid the cause, fix it, and add a one-tap diagnostic that names the real cause on your phone.
- **Reproduced (before any fix):** with a *GitHub App* user token (app not installed) ZIPORA showed exactly what you reported: login works, `GET /user` returns the right login, **zero repositories**, and the private repo answers **404 → NOT_FOUND** — and the UI said only "No repositories found — create a repository", with **no error and no explanation**. With an OAuth token lacking the `repo` scope, private repositories silently vanished. With a normal OAuth App token that has `repo`, listing worked correctly (public + private).
- **Most likely cause on your side (unconfirmed):** the `GITHUB_CLIENT_ID`/`SECRET` in Vercel belong to a **GitHub App**, or `GITHUB_OAUTH_SCOPE` is not `repo`. GitHub answers 404 (not 403) for repositories a token cannot see, which is why a repository that exists looks "not found".
- **Fix:** ZIPORA no longer presents an empty list as normal. It shows a warning and runs diagnostics that report the account, token type, scopes GitHub reports, the HTTP status/message of each call, and public/private counts.

## Trace of the flow (read from the code, then exercised in tests)
1. `/api/auth/login` → GitHub authorize URL with `client_id`, `redirect_uri`, `scope=repo` (or none), `state`, PKCE (`githubOAuth.authorizeUrl`).
2. `/api/auth/callback` → verifies `state`, exchanges the code (`exchangeCode`), checks granted scopes (`hasRequiredScopes`), calls `GET /user` **with that token** (`fetchGitHubUser`), stores the token inside the AES-GCM session cookie (`newSession` → `cookieFor`). Now logs `[zipora] sign-in` (login, token type, scopes).
3. Browser → `/api/github/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=N&sort=updated` → `withAuth` decrypts the cookie → the proxy sends `Authorization: Bearer <session token>` to GitHub. **Verified by test that `/user`, `/user/repos` and `/repos/…` all carry the identical token** (and the diagnostics report a token fingerprint proving it).
4. Response → proxy returns status/body unchanged (+ rate-limit headers); `listRepositories` pages through results; the page renders them. Now logs `[zipora] github` with status, scopes and repository count.
Nothing in cookie handling, pagination, response parsing or frontend state dropped repositories in any scenario I could model; the empty list came from GitHub itself.

## What changed (exact files)
Added: `src/server/diagnose.ts`, `src/types/diagnose.ts`, `api/auth/diagnose.ts`, `src/components/RepoDiagnostics.tsx`, `tests/server/diagnose.test.ts`, `tests/ui/repo-listing.test.tsx`, `tests/e2e/diagnostics.spec.ts`.
Modified: `src/server/app.ts` (diagnose route, sign-in log), `src/server/proxy.ts` (safe upstream log), `src/server/errors.ts` (`logInfo`), `src/client/auth.ts` (`diagnose()`), `src/services/github.ts` (`visibility=all`), `src/pages/RepositoryPage.tsx` (no more silent empty state; "Not seeing your repositories?"), `src/pages/WorkspacePage.tsx` (diagnostics after NOT_FOUND/PERMISSION/AUTH), `src/pages/DocsPage.tsx`, `README.md`, tests: `tests/server/fakeOAuth.ts`, `tests/ui/app-flow.test.tsx` (removed a racy assertion).
Unchanged: `src/engine/*` (byte-identical), Vercel config, UI layout.

## Test results
| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| `npm test` | **283 / 283** (was 263; +20 for this fix) |
| Playwright desktop Chrome / Android Pixel 7 profile (mocked GitHub) | **32 / 32** and **38 / 38** |
| `check:esm` | 6 / 6 Vercel functions load under strict Node ESM |
| Mutation checks | 14 deliberate regressions (silent empty state, different token, token/secret in logs or response, missing `visibility=all`, wrong owner, stale branch, scope/app detection, forwarded repo names…) — each caught by ≥ 1 test |
Scenarios covered: public + private listing, GitHub App token not installed / installed, OAuth token without `repo`, revoked token, read-only repository, organization repo, repository name with a dot, branch name with a slash, >100 repositories (pagination), logging safety.
Deployment targeting: tests prove every GitHub call goes to the **selected** `owner/name` and branch (private user repo on `main`; org repo `acme/my.repo` on new branch `release/v1`) and never to another owner; switching repositories resets the branch.

## NOT verified
- **Your real account/Vercel.** All tests use a mocked GitHub that I modelled on GitHub's documented behaviour (404 for invisible repos; GitHub App tokens limited to installations; `X-OAuth-Scopes` only on classic tokens). I could not capture real payloads: GitHub rate-limited this sandbox, so response-shape tests use documented shapes, not recorded ones.
- That your cause is the GitHub-App/scope one. **Open the diagnostics once; it will say.** If it reports `ALL_CHECKS_PASSED` yet repositories are missing, send me the copied report — that would be a different cause.
