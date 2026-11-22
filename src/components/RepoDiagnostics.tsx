import { Copy, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { DiagnoseReport, TokenKind } from '../types/diagnose';
import { Alert, Button, ErrorAlert, Spinner } from './ui';

const KIND: Record<TokenKind, string> = { 'oauth-app': 'OAuth App token (gho_…)', 'github-app-user': 'GitHub App user token (ghu_…)', unknown: 'Unknown token type' };

/** Asks the server to test GitHub access with the session token and shows exactly what GitHub answered. Safe to paste into a bug report. */
export function RepoDiagnostics({ repo, autoRun }: { repo?: string; autoRun?: boolean }) {
  const { client } = useAuth();
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; report?: DiagnoseReport; error?: unknown }>({ status: 'idle' });
  const [copied, setCopied] = useState<'ok' | 'fail'>();

  const run = useCallback(async () => {
    setState({ status: 'running' });
    setCopied(undefined);
    try { setState({ status: 'done', report: await client.diagnose(repo) }); } catch (error) { setState({ status: 'error', error }); }
  }, [client, repo]);
  useEffect(() => { if (autoRun) void run(); }, [autoRun, run]);

  const r = state.report;
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); setCopied('ok'); } catch { setCopied('fail'); }
  };

  return (
    <section aria-label="GitHub access diagnostics" className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium"><Stethoscope className="h-4 w-4" aria-hidden />GitHub access diagnostics{repo ? ` · ${repo}` : ''}</h3>
        {state.status !== 'running' && <Button size="sm" onClick={() => void run()}>{state.status === 'idle' ? 'Run diagnostics' : 'Run again'}</Button>}
      </div>
      {state.status === 'idle' && <p className="text-sm text-muted">Checks which GitHub account and permissions ZIPORA is using, and why repositories might be missing. Nothing is changed.</p>}
      {state.status === 'running' && <Spinner label="Asking GitHub" />}
      {state.status === 'error' && <ErrorAlert error={state.error} onRetry={() => void run()} />}
      {r && (
        <>
          <div className="space-y-2">
            {r.diagnosis.map((d) => <Alert key={d.code} tone={d.severity === 'error' ? 'danger' : d.severity === 'warn' ? 'warn' : 'success'} title={d.code}>{d.message}</Alert>)}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Signed in as</dt><dd>{r.user.login ? `@${r.user.login}` : '—'} {r.user.login && (r.user.matchesSession ? '(matches your session)' : '(DIFFERENT from your session)')}</dd>
            <dt className="text-muted">Token type</dt><dd>{KIND[r.token.kind]}</dd>
            <dt className="text-muted">Same token for every check</dt><dd>{r.token.sameTokenForAllCalls ? 'Yes' : 'No'} <span className="font-mono text-xs text-muted">({r.token.fingerprint})</span></dd>
            <dt className="text-muted">OAuth scopes</dt><dd className="break-words">{r.user.grantedScopes === null ? 'not reported by GitHub' : r.user.grantedScopes.length ? r.user.grantedScopes.join(', ') : 'none'}</dd>
            <dt className="text-muted">GET /user</dt><dd>HTTP {r.user.status}{r.user.message ? ` — ${r.user.message}` : ''}</dd>
            <dt className="text-muted">GET /user/repos</dt><dd>HTTP {r.repos.status}{r.repos.message ? ` — ${r.repos.message}` : ''}</dd>
            <dt className="text-muted">Repositories</dt><dd>{r.repos.count} ({r.repos.publicCount} public, {r.repos.privateCount} private){r.repos.truncated ? ', more not counted' : ''}{r.repos.sample.length ? <span className="block break-all font-mono text-xs text-muted">{r.repos.sample.join(', ')}</span> : null}</dd>
            {r.repoCheck && (<><dt className="text-muted">{r.repoCheck.name}</dt><dd>HTTP {r.repoCheck.status}{r.repoCheck.message ? ` — ${r.repoCheck.message}` : ''}{r.repoCheck.private !== undefined ? ` · ${r.repoCheck.private ? 'private' : 'public'}` : ''}{r.repoCheck.branches ? ` · branches: HTTP ${r.repoCheck.branches.status}${r.repoCheck.branches.count !== undefined ? ` (${r.repoCheck.branches.count})` : ''}` : ''}</dd></>)}
            {r.installations && (<><dt className="text-muted">App installations</dt><dd>HTTP {r.installations.status}{r.installations.count !== undefined ? ` · ${r.installations.count}` : ''}</dd></>)}
            <dt className="text-muted">Rate limit left</dt><dd>{r.rateLimit.remaining ?? '—'}</dd>
          </dl>
          <Button size="sm" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden />{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy report'}</Button>
        </>
      )}
    </section>
  );
}
