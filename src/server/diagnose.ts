import { createHash } from 'node:crypto';
import type { DiagnoseReport, Diagnosis, TokenKind } from '../types/diagnose.js';
import { logInfo } from './errors.js';
import type { Deps } from './githubOAuth.js';
import type { Session } from './session.js';

const API = 'https://api.github.com';
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_PAGES = 5;

/** The prefix identifies the token TYPE (it is public information, not a secret). */
export const tokenKindOf = (token: string): TokenKind => (token.startsWith('gho_') ? 'oauth-app' : token.startsWith('ghu_') ? 'github-app-user' : 'unknown');
const fingerprint = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 8);

interface Called { status: number; headers: Headers; body: unknown; message?: string; fp: string }

async function call(deps: Deps, token: string, path: string): Promise<Called> {
  const fp = fingerprint(token); // computed from the exact value placed in the Authorization header
  try {
    const res = await deps.fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ZIPORA', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    const m = (body as { message?: unknown } | undefined)?.message;
    return { status: res.status, headers: res.headers, body, message: !res.ok && typeof m === 'string' ? m : undefined, fp };
  } catch {
    return { status: 0, headers: new Headers(), body: undefined, message: 'Could not reach GitHub', fp };
  }
}

const parseScopes = (h: string | null): string[] | null => (h === null ? null : h.split(',').map((s) => s.trim()).filter(Boolean));

/**
 * Calls GitHub with the session's token (the same one the proxy uses) and explains why repositories may be missing.
 * Returns status codes, GitHub's own messages, counts and scopes. Never the token itself.
 */
export async function runDiagnostics(deps: Deps, session: Session, secrets: readonly string[], repoName?: string): Promise<DiagnoseReport> {
  const token = session.token.access;
  const kind = tokenKindOf(token);
  const fps = new Set<string>();
  const track = (c: Called) => { fps.add(c.fp); return c; };

  const u = track(await call(deps, token, '/user'));
  const login = typeof (u.body as { login?: unknown } | undefined)?.login === 'string' ? (u.body as { login: string }).login : undefined;
  const grantedScopes = parseScopes(u.headers.get('x-oauth-scopes'));

  // Same query the app uses for its repository list (all visibilities, all affiliations).
  let status = 0; let message: string | undefined; let count = 0; let publicCount = 0; let privateCount = 0; let pages = 0; let truncated = false;
  const sample: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = track(await call(deps, token, `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`));
    if (page === 1) { status = r.status; message = r.message; }
    if (r.status !== 200 || !Array.isArray(r.body)) { if (page > 1) { status = r.status; message = r.message; } break; }
    pages = page;
    for (const x of r.body as Array<Record<string, unknown>>) {
      count++;
      if (x.private === true) privateCount++; else publicCount++;
      if (sample.length < 5 && typeof x.full_name === 'string') sample.push(x.full_name);
    }
    if (r.body.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  let repoCheck: DiagnoseReport['repoCheck'];
  if (repoName && REPO_NAME.test(repoName)) {
    const [owner, name] = repoName.split('/');
    const r = track(await call(deps, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`));
    const b = (r.body ?? {}) as { private?: unknown; permissions?: { push?: unknown; admin?: unknown } };
    repoCheck = { name: repoName, status: r.status, message: r.message, private: typeof b.private === 'boolean' ? b.private : undefined, canPush: r.status === 200 ? b.permissions?.push === true || b.permissions?.admin === true : undefined };
    if (r.status === 200) {
      const br = track(await call(deps, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100`));
      repoCheck.branches = { status: br.status, count: Array.isArray(br.body) ? br.body.length : undefined, message: br.message };
    }
  }

  let installations: DiagnoseReport['installations'];
  if (kind !== 'oauth-app') {
    const r = track(await call(deps, token, '/user/installations?per_page=100'));
    const total = (r.body as { total_count?: unknown } | undefined)?.total_count;
    installations = { status: r.status, count: typeof total === 'number' ? total : undefined, message: r.message };
  }

  const diagnosis: Diagnosis[] = [];
  const add = (code: string, severity: Diagnosis['severity'], msg: string) => diagnosis.push({ code, severity, message: msg });
  const who = login ? `@${login}` : 'this account';
  const scopeText = grantedScopes === null ? 'no X-OAuth-Scopes header' : grantedScopes.length ? grantedScopes.join(', ') : 'none';

  if (u.status === 401) add('TOKEN_REJECTED', 'error', 'GitHub rejected the access token (401). It was revoked or has expired. Sign out and sign in again.');
  else if (u.status !== 200) add('USER_CHECK_FAILED', 'error', `GET /user failed with HTTP ${u.status}${u.message ? `: ${u.message}` : ''}.`);
  if (login && login.toLowerCase() !== session.user.login.toLowerCase()) add('SESSION_USER_MISMATCH', 'error', `The token belongs to @${login} but the session says @${session.user.login}. Sign out and sign in again.`);

  if (kind === 'github-app-user') {
    add('GITHUB_APP_TOKEN', count === 0 ? 'error' : 'warn',
      'This sign-in produced a GitHub App user token (ghu_…), not an OAuth App token. The "repo" scope does not apply to it: it can only see repositories where the GitHub App is installed. ' +
      'Fix: create a classic OAuth App (GitHub → Settings → Developer settings → OAuth Apps), put ITS Client ID/Secret in Vercel and set GITHUB_OAUTH_SCOPE=repo, then sign in again — or install your GitHub App on the repository.');
    if (installations) add('APP_INSTALLATIONS', 'info', installations.status === 200 ? `The GitHub App is installed on ${installations.count ?? 0} of your accounts/organizations.` : `Could not list installations (HTTP ${installations.status}).`);
  } else if (kind === 'oauth-app' && grantedScopes) {
    if (!grantedScopes.includes('repo')) {
      add(grantedScopes.includes('public_repo') ? 'PUBLIC_REPO_SCOPE_ONLY' : 'MISSING_REPO_SCOPE', 'error',
        `The token has these scopes: ${scopeText}. Without "repo", GitHub hides private repositories (and answers 404 for them). Set GITHUB_OAUTH_SCOPE=repo in Vercel, redeploy, sign out and sign in again, and approve the permission.`);
    }
  } else if (kind === 'unknown' && grantedScopes === null && u.status === 200) {
    add('NO_SCOPE_HEADER', 'warn', 'GitHub did not report OAuth scopes for this token, so it is probably not a classic OAuth App token. Check that GITHUB_CLIENT_ID/SECRET belong to an OAuth App.');
  }

  if (status !== 200) add('REPO_LIST_FAILED', 'error', `GET /user/repos failed with HTTP ${status}${message ? `: ${message}` : ''}.`);
  else if (count === 0) add('EMPTY_REPO_LIST', 'warn', `GitHub returned 0 repositories for ${who} (scopes: ${scopeText}). If you own or can push to repositories, see the other findings: the usual cause is the wrong kind of token or a missing "repo" scope.`);

  if (repoCheck) {
    if (repoCheck.status === 404) {
      add('REPO_NOT_VISIBLE', 'error', `GitHub answers 404 for ${repoCheck.name}. GitHub does this for any repository the token cannot see — private ones included. ` + (kind === 'github-app-user'
        ? 'With a GitHub App token the app must be installed on this repository.'
        : grantedScopes && !grantedScopes.includes('repo') ? 'This token lacks the "repo" scope.' : 'Check the owner/name spelling and that you are signed in as an account with access; organization repositories may also need the organization to approve this app.'));
    } else if (repoCheck.status !== 200) add('REPO_CHECK_FAILED', 'error', `GET /repos/${repoCheck.name} failed with HTTP ${repoCheck.status}${repoCheck.message ? `: ${repoCheck.message}` : ''}.`);
    else {
      if (repoCheck.canPush === false) add('NO_PUSH_ACCESS', 'error', `You can see ${repoCheck.name} but do not have push access to it.`);
      if (repoCheck.branches && (repoCheck.branches.status !== 200 || repoCheck.branches.count === 0)) add('NO_BRANCHES', 'warn', `${repoCheck.name} has no branches (it may be empty). Create a first commit on GitHub, then try again.`);
    }
  }
  const rate = { remaining: u.headers.get('x-ratelimit-remaining'), reset: u.headers.get('x-ratelimit-reset') };
  if (rate.remaining === '0') add('RATE_LIMITED', 'error', 'GitHub rate limit reached for this token. Wait until the reset time and retry.');
  if (!diagnosis.some((d) => d.severity !== 'info')) add('ALL_CHECKS_PASSED', 'info', `${who}: ${count} repositories visible (${publicCount} public, ${privateCount} private).${repoCheck ? ` ${repoCheck.name} is accessible.` : ''}`);

  const report: DiagnoseReport = {
    checkedAt: new Date().toISOString(),
    token: { kind, fingerprint: fingerprint(token), sameTokenForAllCalls: fps.size === 1 && fps.has(fingerprint(token)) },
    user: { status: u.status, login, message: u.message, matchesSession: !!login && login.toLowerCase() === session.user.login.toLowerCase(), grantedScopes, acceptedScopes: u.headers.get('x-accepted-oauth-scopes') },
    repos: { status, message, count, publicCount, privateCount, pages, truncated, sample },
    repoCheck, installations, rateLimit: rate, diagnosis,
  };
  logInfo('diagnose', { login, userStatus: u.status, tokenKind: kind, scopes: grantedScopes ?? 'no-header', reposStatus: status, reposMessage: message, repos: count, public: publicCount, private: privateCount, repoCheck: repoCheck ? { status: repoCheck.status } : undefined, findings: diagnosis.map((d) => d.code) }, secrets);
  return report;
}
