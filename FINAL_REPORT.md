# ZIPORA 1.0 — Final release report (Phase 4)

Everything below was measured by running the commands in this environment. Where something was **not** verified, it says so.

## Verified results
| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| `npm test` (Vitest: engine, server, UI, full-app flows) | **283 / 283** passed (16 files) |
| `npm run e2e` — desktop Chrome | **32 passed, 0 failed** |
| `npm run e2e` — Android Pixel 7 profile (412×915, touch) | **38 passed, 0 failed** |
| `npm run build` | success; initial JS 94 kB gzip, CSS 7 kB gzip; engine/app pages lazy-loaded |
| `npm run check:esm` | 6 / 6 Vercel functions load under strict Node ESM |
| Browser bundle scan | no server code, secret names, `process.env`, `VITE_`, or token-shaped strings |
| Phase 1–3 code | `src/engine`, `src/server`, `src/client`, `api/` **byte-identical to Phase 3** |

**All E2E tests run against a MOCKED GitHub.** The real ZIPORA UI and server code run in real Chromium; GitHub's OAuth and REST API are an
in-memory fake, and the suite fails if any request leaves `localhost`. See `docs/REAL_GITHUB_CHECKLIST.md` for the manual test against real GitHub.
The browser used here is Chromium 153 from the `@sparticuz/chromium` npm package (Playwright's own browser download is blocked in this sandbox);
on a normal machine `npx playwright install chromium` is used automatically.

## What was completed in Phase 4
1. **Deployment progress** — live stages with real per-stage durations, counters (processed/succeeded/failed/elapsed), progress bar, expandable logs, copy **and download** logs, cancel until the commit starts, clear success / no-changes / cancelled / failed screens with the primary action first; result scrolls into view on completion.
2. **History** — search, filter by status and repository, sort, relative + absolute timestamps, repository/branch, commit SHA and GitHub links, details, per-record delete with confirmation, clear all, **export as ZIP** (history.json + per-deployment logs), per-GitHub-account isolation.
3. **Documentation** — full in-app docs (getting started, connecting GitHub, ZIPs, repositories, branches, deployment process, file sizes, common errors table generated from the code, troubleshooting, Android, security/privacy); README, env guide, deployment guide, real-GitHub checklist.
4. **UI/UX polish** — consistent tokens and components, one subtle page transition (disabled by reduced-motion), improved empty/loading/error states, focus-trapped drawer, arrow-key file tree, ≥ 44 px touch targets, accessible names.
5. **Android-first** — bottom navigation, full-width touch actions, native file chooser with the MIME types Android reports, touch wording, 16 px inputs (no zoom), downloads of logs/exports via normal browser downloads, in-app-browser OAuth hint, nothing requires a PC after the code is on GitHub.
6. **Vercel** — final `vercel.json` (Vite framework, SPA rewrite excluding `/api`, function duration, CSP, HSTS, X-Frame-Options, Permissions-Policy, immutable asset caching, `/api` uncached); `.env.example`; secrets never reach the bundle (scanned).
7. **Playwright** — 9 spec files covering landing, real OAuth redirect chain with cookies, dashboard, ZIP upload, repository selection, branch/repo creation, preview, deployment (success, failure, cancel, progress), history/export, settings, mobile layout/touch audits, accessibility (axe, both themes), screenshots.

## Bugs found and fixed in this phase (mostly by the real browser)
| Found by | Bug | Fix |
|---|---|---|
| Real browser screenshot | On phones the archive filename collapsed to "s." (buttons squeezed it) | Stacked layout |
| Real browser audit | Buttons 36 px, text links 20 px (below Android's 48 dp guideline) | 44 px targets, `.tap` links |
| Real browser screenshot | Deployment result was buried below the config form on phones | Result-first layout |
| Real browser (test, 4/4 failure) | After finishing, the page stayed scrolled past the success heading/commit button | Instant scroll to result after layout |
| axe-core | Accent text only 3.9:1 on dark; light-theme status colours 3.6–4.2:1 | New text tokens; darker light tokens |
| axe-core | Prose links distinguished by colour only | Underlined |
| axe-core | Buttons nested inside `<summary>` (logs) | Disclosure button + separate actions |
| axe-core | Account menu button had no accessible name on phones; bottom-nav / step labels didn't match visible text; scrollable docs table not keyboard-focusable | Proper names / `tabIndex` |
| Mutation testing | Live-stage duration code path untested | Test added |
| Phase 3 audit | OAuth redirect hop can't be intercepted by Playwright (went to real github.com in my first attempt) | First hop rewritten; suite asserts nothing leaves localhost |

## Known limitations
- **Not verified:** real GitHub (OAuth, rate limits, org approvals, branch protection), a physical Android device, a live Vercel deployment, Firefox/Safari, screen readers (only automated axe scans, which catch a fraction of issues), the GitHub Android app's handling of the OAuth link, the "code onto GitHub from a phone" options (Termux/Codespaces/bootstrap tool).
- Through the serverless proxy a single file above ≈ 3.2 MB is refused (Vercel's ~4.5 MB request cap); large repository trees may exceed the response cap.
- Archive limits 100 MB / 5,000 files / 500 MB extracted; whole archive held in memory (a low-memory phone may struggle near the limit); ZIP64/encrypted unsupported.
- History/preferences are per browser (export for backup); stateless sessions can't be revoked server-side (sign-out revokes the GitHub token; rotate `SESSION_SECRET` to end all sessions).
- Token refresh across several serverless instances can race (GitHub App mode only).
- Getting ZIPORA's own source onto GitHub is the one step that is awkward without a computer.
