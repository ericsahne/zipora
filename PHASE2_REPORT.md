# ZIPORA — Phase 2: Authentication backend

All results below come from commands actually run in this environment (Node, Vitest, TypeScript strict, Vite).

## Verified results
| Check | Result |
|---|---|
| `tsc --noEmit` (strict, includes `api/`, `src/server`, `src/client`, tests) | clean |
| `vitest run` | **179 / 179 passed** — Phase 1: 91 (unchanged), Phase 2: 88 |
| `npm run build` | success; `dist/zipora-engine.js` byte-for-byte the same size as Phase 1 (162.84 kB) |
| `npm run check:esm` | all 5 Vercel entry points compile under `module: NodeNext` (which rejects extensionless imports) and load in plain Node ESM |
| Phase 1 engine | `diff -r` against the delivered Phase 1 zip: **0 differences** |
| Secret scan | no `VITE_`, `CLIENT_SECRET`, `SESSION_SECRET` or `process.env` in `src/client`, `src/engine` or the built bundle; client/engine import no server code |
| Mutation check | 13 security-critical lines broken one at a time — each caught by at least one test (table below) |
| Measured session cookie size | 383 bytes (OAuth App), 524 bytes (GitHub App with refresh token); limit ≈ 4096 |

## Architecture
```
Browser (SPA)                         Vercel Functions                       GitHub
─────────────                         ────────────────                       ──────
location → /api/auth/login  ───────►  state + PKCE, sealed oauth cookie ───► /login/oauth/authorize
                            ◄───────  302
(user approves)             ───────►  /api/auth/callback
                                      verify state, exchange code (+secret) ► /login/oauth/access_token
                                      fetch profile ───────────────────────► api.github.com/user
                            ◄───────  Set-Cookie: __Host-zipora_session (AES-256-GCM, HttpOnly, Secure, SameSite=Lax)
AuthClient.getSession()     ───────►  /api/auth/session  → user + csrfToken (never the token)
Phase 1 GitHubClient        ───────►  /api/github/*  (session + CSRF + allow-list)  ──►  token attached SERVER-SIDE
   baseUrl=/api/github                
POST /api/auth/logout       ───────►  CSRF check → revoke token at GitHub → clear cookies
```
- **The GitHub access token never reaches browser JavaScript.** It lives only inside the encrypted HttpOnly cookie and is attached by the proxy. The Phase 1 `GitHubClient` is reused *unchanged*: `AuthClient.createGitHubClient()` just sets `baseUrl` and a CSRF-adding `fetchImpl`.
- **Token storage:** stateless — token sealed with AES-256-GCM (HKDF-derived key, random 96-bit IV, cookie purpose authenticated as AAD so an OAuth-state cookie can never be replayed as a session). Key rotation via `SESSION_SECRET_PREVIOUS`.

## Files added (Phase 2)
`api/auth/{login,callback,session,logout}.ts`, `api/github/[...path].ts` (thin Vercel entry points) ·
`src/server/`: `config`, `crypto`, `cookies`, `errors` (+ log redaction), `githubOAuth`, `session` (refresh), `middleware` (`withAuth`, `withErrors`, CSRF, same-site), `proxy`, `app` (handlers + router), `node` (Fetch↔Node adapter), `runtime` ·
`src/client/auth.ts` · `vercel.json` · `.env.example` · `tsconfig.server.json`, `scripts/check-esm.mjs` · `tests/server/*` (5 files).
Changed in Phase 1 files: none (`src/engine` identical). `package.json` gained one script; `tsconfig.json` now includes `api/`.

## Requirement by requirement
| Requirement | Implementation | Evidence |
|---|---|---|
| GitHub OAuth login | Authorization-code flow + PKCE (S256) + single-use `state` | flow tests incl. fake that rejects bad client secret / verifier / reused code |
| Secure callback | state compared in constant time; state cookie sealed, 10-min TTL, always consumed; `returnTo` restricted to same-origin paths; failures redirect to `/?auth_error=CODE`, never create a session | 9 failure-path tests (mismatch, missing cookie, replay, expiry, denied, forged code, scope, misconfig, outage) |
| Encrypted HttpOnly cookies | `__Host-` prefix on https, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, Max-Age | cookie-attribute assertions; mutation M7/M8 |
| Secure token storage | see above; token never in any response body/header (asserted by scanning everything the browser receives during a full deployment) | integration test |
| Session validation | decrypt → expiry → shape check; tampered / wrong-purpose / expired cookies rejected and cleared; `?verify=1` detects tokens revoked on GitHub | 5 session tests |
| Logout | CSRF-protected POST; revokes the token at GitHub (`DELETE /applications/{id}/token`, Basic auth); clears cookies; still signs out locally if GitHub is unreachable | 4 logout tests |
| Auth middleware | `withAuth`: same-site → session → CSRF → token refresh → handler; `withErrors` | proxy tests |
| CSRF | (1) `Sec-Fetch-Site: cross-site` rejected, (2) `Origin` must equal `APP_URL`, (3) per-session HMAC token in `X-CSRF-Token` for every non-GET; token only obtainable same-origin | 3 + 4 tests; M1, M9 |
| Env configuration | `loadConfig` validates everything, reports variable *names* only; `.env.example` | 8 config tests |
| Error handling | structured `{error:{code,message,hint}}`; unknown errors → generic 500; logs redact token shapes and secrets | 3 tests |
| Expired authorization | GitHub App expiring tokens refreshed transparently (5-min window); refresh failure → 401 + cleared cookie | 5 refresh tests |
| Permission errors | scope check after login (`INSUFFICIENT_SCOPE`, token revoked); proxy passes GitHub 403 + `x-accepted-*` headers through | tests |

## Bugs found and fixed while building (by my own tests)
1. **Refresh race:** concurrent requests at token expiry — those arriving after the first refresh finished reused a spent single-use refresh token and got 401 (would break parallel uploads). Fixed with a 60 s in-memory grace window (in addition to in-flight de-duplication). Caught by the concurrency test; mutation M12 re-confirms.
2. `returnTo` accepted percent-encoded CR/LF. Not exploitable (value is never decoded into a header) but now rejected as defence in depth.
3. `getApp()` threw synchronously on bad config instead of returning a rejected promise; now uniformly async.

## Mutation check (security controls)
| Broken on purpose | Tests that failed |
|---|---|
| CSRF verification | 3 | PKCE verifier not sent | 44 |
| OAuth state comparison | 1 | granted-scope check | 1 |
| cookie purpose (AAD) | 1 | refresh grace window | 1 |
| `returnTo` sanitiser | 1 | cookie cleared on upstream 401 | 1 |
| proxy allow-list | 9 | HttpOnly flag | 3 |
| client `Authorization` forwarded | 1 | Secure flag | 3 |
| same-site / Origin check | 2 | | |

## Setup (not exercised against real GitHub — see below)
1. GitHub → Settings → Developer settings → **OAuth Apps** → New. Homepage `APP_URL`; callback **`APP_URL/api/auth/callback`** (exact).
2. Vercel → Project → Environment Variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_URL`, `SESSION_SECRET` (`openssl rand -base64 48`); optional ones in `.env.example`. Never use a `VITE_` prefix.
3. Local: `http://localhost:PORT` is allowed for `APP_URL`; use a separate OAuth app for it (GitHub allows one callback URL per app).

## NOT verified — do not treat as working
- **No real GitHub OAuth app or GitHub API was used.** `tests/server/fakeOAuth.ts` is my model of GitHub's behaviour. Differences are possible, e.g. whether GitHub OAuth Apps enforce PKCE (if ignored, `state` still protects the flow), exact error codes, rate-limit headers.
- **Nothing was deployed to Vercel.** Unverified Vercel-side assumptions: request stream readable in Node functions, `api/github/[...path].ts` catch-all routing, `maxDuration: 60`, the 4.5 MB request/response limits, and `vercel.json`. The `/index.html` rewrite points at a SPA that does not exist until Phase 3, and `npm run build` currently builds only the engine library, so a Vercel deploy now would serve the API only.
- **No real browser.** `__Host-` cookies, SameSite=Lax across the GitHub redirect, and `Sec-Fetch-Site` behaviour are tested with a simulated jar. Safari does not accept `Secure` cookies on plain-http localhost.
- **GitHub App mode** (expiring tokens) is tested only against the fake. A real GitHub App also needs to be *installed* on target repositories; there is no UI or handling for that yet.
- No rate limiting on `/api/auth/login` (use Vercel Firewall).

## Known limitations (by design / honest trade-offs)
- **Serverless body limit (~4.5 MB):** through the proxy, a single file above ≈3.37 MB cannot be uploaded (`AuthClient.zipLimits()` makes ZIP inspection reject such files up front; tested). Responses are capped similarly — a recursive tree of a very large repository may not fit. Direct-to-GitHub upload would remove the limit but requires exposing the token to JavaScript; I did not do that.
- **Stateless sessions cannot be revoked server-side.** Logout revokes the GitHub token and clears the cookie, but a copied cookie stays decryptable until `SESSION_TTL_SECONDS` unless its token is revoked; rotating `SESSION_SECRET` invalidates all sessions.
- **Refresh across multiple serverless instances** can still race (the de-dup and grace window are per instance). The SPA should call `GET /api/auth/session` before long deployments so the refresh happens early.
- Default scope is `repo` (needed for private repos); use `public_repo` or a GitHub App for narrower access.
