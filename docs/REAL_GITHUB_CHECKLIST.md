# Real-GitHub verification checklist

ZIPORA's automated tests run against a **mocked GitHub** (an in-memory fake of GitHub's OAuth and REST endpoints). They prove
ZIPORA's own behaviour, but they cannot prove that GitHub accepts every request exactly as the fake does. **Before relying on a
deployment of ZIPORA, run this once against real GitHub, with a throw-away repository.** It takes about 15 minutes and works
entirely from a phone browser.

Preparation: deploy ZIPORA (see README), create the GitHub OAuth App, set the four environment variables, and create an empty
**private test repository** (add a README so it has a `main` branch). Make a tiny test ZIP (3–4 small files, one inside a folder).

| # | Check | Expected | ✔ |
|---|-------|----------|---|
| 1 | Open ZIPORA in Chrome → **Sign in with GitHub** | GitHub shows the authorization page naming your app and the `repo` scope; approving returns you to the Dashboard with your avatar and username | |
| 2 | Dashboard → account card | Shows your real name/username and permissions `repo` | |
| 3 | New deployment → choose the test ZIP | Archive verifies; tree shows all files | |
| 4 | Repository step | Your real repositories are listed (public/private badges); the test repository is selectable | |
| 5 | Select the test repository | `main` is preselected; details are correct | |
| 6 | **New branch** → `zipora-test` | Branch appears on github.com/OWNER/REPO/branches | |
| 7 | Review → **Preview changes** | Counts match what you expect (new/changed/unchanged); nothing is written | |
| 8 | **Deploy** to `zipora-test` | Progress completes; ONE new commit appears on that branch on github.com; files and folders match the ZIP | |
| 9 | Click **View commit on GitHub** | Opens the commit; SHA matches the one shown in ZIPORA | |
| 10 | Deploy again with the same ZIP | "No changes" — no new commit | |
| 11 | Change one file in the ZIP, deploy with a target folder `docs` | New commit; files appear only under `docs/` | |
| 12 | Enable **Delete files not in the archive**, preview, deploy | Preview lists deletions; only files under the target folder are removed | |
| 13 | **New repository** (private) | Repository is created with an initial commit and can be deployed to | |
| 14 | Deploy to a branch protected by a rule | Either succeeds or shows a clear GitHub permission/conflict message; nothing half-applied | |
| 15 | History | The deployments are listed with correct repo, branch, SHA, time; export ZIP downloads | |
| 16 | Revoke ZIPORA at github.com/settings/applications, then use the app | "Session expired" screen appears; signing in again works | |
| 17 | Sign out | GitHub shows the authorization is revoked (token removed); cookie gone | |
| 18 | (Organization repo, if you use one) | Repository appears; if not, an owner must approve ZIPORA in the organization's third-party access settings | |
| 19 | (Optional) Large file | A ~3 MB file deploys; a ~4 MB file is refused with the size message before upload | |
| 20 | Watch for GitHub rate limiting on a large ZIP (hundreds of files) | Either completes, or stops with a "rate limit" message and nothing committed | |

Record the date, the ZIPORA version, and any step that behaved differently from the mock. Differences are bugs in ZIPORA's
assumptions about GitHub (please fix the code, then extend the mock so the test suite catches it next time).

## What the automated suites do and do not prove
| Suite | Runs against | Proves | Does NOT prove |
|---|---|---|---|
| `npm test` (Vitest, 249 tests) | In-process server + fake GitHub, jsdom | Engine/server/UI logic | Real browser behaviour, real GitHub |
| `npm run e2e` (Playwright, desktop + Android viewport) | Production build in real Chromium + real server code + **mock GitHub** | Real-browser UI, cookies, CSP, layout, touch targets, accessibility, downloads | GitHub's real responses; Android devices; Safari/Firefox |
| This checklist | **Real GitHub** | Real OAuth, API behaviour, rate limits, permissions | (manual) |
