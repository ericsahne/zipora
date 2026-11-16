# ZIPORA — Phase 3: App shell and functional UI

All results below come from commands actually run in this environment (Node, Vitest + jsdom, TypeScript, Vite, Tailwind v4, React 19, React Router 7).

## Verified results
| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| `vitest run` | **249 / 249 passed** — Phases 1–2: 179 (+1 new), Phase 3: 69 new |
| `npm run build` (app) | success. Initial JS **94.6 kB gzip**, CSS 6.5 kB gzip; app pages and the ZIP engine are lazy-loaded |
| `npm run build:engine` | success (Phase 1 library build kept) |
| `npm run check:esm` | all 5 Vercel functions still load under strict Node ESM |
| Dev server | `vite` serves the SPA **and the real Phase 2 `/api` routes**: `/api/auth/session` → `{"authenticated":false}`, `/api/auth/login` → 302 to GitHub with PKCE + state + cookie flags, `/api/github/*` → 401 without a session, unconfigured → `CONFIG_ERROR` listing variable names only |
| Browser bundle scan | no `node:crypto`, `SESSION_SECRET`, `CLIENT_SECRET`, `process.env`, `VITE_`, or token-shaped strings |
| Source scan | no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` |
| Mutation check | 11 frontend integrity/security behaviors broken one at a time — each caught by ≥ 1 test |

## How the tests work (important for what they prove)
The UI tests render the **real React app** (jsdom) against the **real Phase 2 server handlers** running in-process, the **real Phase 1 engine** (ZIP inspection, `planDeployment`, `executeDeployment`) and the **real `AuthClient`/`GitHubClient`**. Only GitHub itself is faked (`tests/server/fakeOAuth.ts`, `tests/fakeGitHub.ts`). So a passing deployment test means: file input → real ZIP validation → real repo/branch calls through the CSRF-protected proxy → real blobs/trees/commit/ref requests → real commit in the fake → real history record.

## Pages (all functional, none are mock-ups)
Landing (CTA starts the real OAuth redirect; maps `?auth_error=` codes to messages) · Dashboard · New deployment (upload) · Repository selection · Deployment workspace · History · Deployment details · Settings · Documentation · Privacy · Terms · 404.
Routes: `/`, `/dashboard`, `/new`, `/new/repository`, `/new/workspace`, `/history`, `/history/:id`, `/settings`, `/docs`, `/privacy`, `/terms` (`/dashboard` matches the Phase 2 callback default).

| Spec item | Implementation | Evidence |
|---|---|---|
| Auth integration | `AuthProvider` over the existing `AuthClient`: session load, avatar/username, logout (revokes token), expiry handling, protected routes, retryable session-check error | 12 tests |
| Session expiry | focus/visibility/5-min revalidation; any **401 from the GitHub proxy** also flips to a "Session expired" screen (small additive hook `AuthClient.onUnauthorized`) | tests + U4/U11 mutations |
| ZIP upload | real `inspectZip` with proxy-aware limits; drag-and-drop + browse; progress; issues list; remove/replace | upload tests |
| File explorer | nested tree, expand/collapse, search, icons, sizes, counts, selected-file info + text preview; paged at 200/folder; **names/contents rendered as text**; invisible/bidi characters shown as `<U+XXXX>` with a warning | 8 explorer tests; U5 |
| Repository selection | real `/user/repos` (paged), search, details, badges, branches, **create repository** (user/org, validated, `auto_init`), **create branch**, push-access/archived/protected warnings | 7 tests |
| Workspace | summary, config, **Preview changes** (real `planDeployment` against the live tree), commit message, **real `executeDeployment`** with live stages/counts/logs, cancel (until commit starts), copy logs, result + commit link | 6 tests |
| History | per GitHub user id, in this browser only; filter/search/open/delete/clear; corrupted data ignored | 8 tests; U2/U9 |
| Dashboard | counts come only from stored records; empty states otherwise; shortcuts preselect a repo | tests |
| Settings | theme (dark/light/system, no flash via `theme-init.js`), account, sign-out, deployment defaults, clear history, clear-on-sign-out; only non-sensitive keys persisted | tests; U6 |
| Navigation | collapsible sidebar (persisted), header, mobile drawer (Escape, focus on dialog), skip link | tests |
| Never expose the token | asserted in a full deployment: token absent from DOM, localStorage and every response the browser received; GitHub saw only the server-attached token | integration test |
| CSRF | every state-changing call goes through `AuthClient`, which adds `X-CSRF-Token` and recovers once from a stale token | Phase 2 + flow tests |

## Bugs found by the Phase 3 tests (and fixed)
1. **Phase 2 proxy bug — repository creation never worked.** The allow-list picked the first rule matching the *path* (`GET /user/repos`) and answered `POST /user/repos` with 405. Fixed in `proxy.ts`; regression test added (and DELETE now correctly reports `Allow: GET, POST`).
2. **Poor GitHub validation errors.** The Phase 1 client showed only "Repository creation failed."; GitHub's `errors[]` detail ("name already exists on this account") is now appended to the message. A first attempt misclassified this as a branch `CONFLICT` (the text matched `/already exists/`); classification now uses only the top-level message. Test added.
3. A test earlier "passed for the wrong reason" (405 vs 422) — strengthened to assert the real GitHub error.
(Test-environment-only: jsdom's `Blob` cannot be a Node `Request` body; handled in `tests/setup.ts`. Not an app issue.)

## Changes to previously delivered code (all small; nothing rewritten)
| File | Change |
|---|---|
| `src/engine/github.ts` (Phase 1) | error-message detail from `errors[]`, classification unchanged (≈30 lines, 1 helper) |
| `src/server/proxy.ts` (Phase 2) | method-aware allow-list (bug fix above) |
| `src/client/auth.ts` (Phase 2) | optional `onUnauthorized` callback |
| `src/server/runtime.ts` (Phase 2) | `routerHandler()` used by the dev server |
| `vite.config.ts` | now the app config (React, Tailwind, dev API plugin); engine library config moved to `vite.engine.config.ts` (`npm run build:engine`) |
| `vercel.json` | + Content-Security-Policy header |
Everything else in `src/engine`, `src/server`, `src/client`, `api/` is byte-identical to the delivered Phase 1 / Phase 2 zips.

## Running it
```
cp .env.example .env     # fill GITHUB_CLIENT_ID / _SECRET, SESSION_SECRET; APP_URL=http://localhost:5173
npm install
npm run dev              # SPA + real /api routes at http://localhost:5173
npm test                 # 249 tests
npm run build            # type-check + production build into dist/
```
GitHub OAuth app callback for local dev: `http://localhost:5173/api/auth/callback`.

## NOT verified — do not treat as working
- **No real browser was used.** Layout, visual design, spacing, colour contrast in practice, responsiveness, "no horizontal overflow", touch behaviour, focus order and screen-reader behaviour are **unverified** (jsdom has no layout engine). Written with `min-w-0`, truncation, `break-all`, `overflow-auto` and responsive classes, but I have not seen it rendered. No screenshots exist.
- **No real GitHub.** OAuth, the GitHub API, rate limits and real repositories were never touched (fake only), as in Phase 2.
- **No Vercel deployment.** Includes the new CSP header (could block something in a real browser — e.g. if GitHub avatar URLs use another host) and `vercel.json` rewrites.
- Keyboard support: all controls are native buttons/links/inputs, but the file tree does not implement arrow-key navigation, and the mobile drawer does not trap focus (it has `aria-modal`, Escape and a visible close button).
- Performance with the maximum archive (5,000 files / 100 MB) was not measured in a browser; folders are paged at 200 rows.
- Colour contrast was chosen (accent `#4F5BFF` on white ≈ 4.9:1; muted text tokens) but not measured by a tool.
- Clipboard "Copy logs" uses `navigator.clipboard` (needs HTTPS/secure context); failure is shown, success path not tested in a real browser.

## Known limitations (by design)
- History is per browser (localStorage), not server-side. Clear it in Settings; optional clear-on-sign-out.
- Through the serverless proxy a single file above ≈3.2 MB is refused before upload (`AuthClient.zipLimits()`); documented in the UI.
- Repository search is client-side over the most recent ≤ 500 repositories (GitHub's search API is not on the proxy allow-list).
- The deployment continues while you navigate inside the app; closing the tab triggers a browser warning but cannot resume.
- Deployment progress, history and docs exist and work, but are the Phase 3 baseline; polish is Phase 4 as planned.
