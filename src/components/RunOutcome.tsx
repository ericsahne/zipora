import { CheckCircle2, ExternalLink, MinusCircle, Slash } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DeployResult } from '../engine';
import { plural, repoUrl } from '../utils/format';
import { buttonClass, Button, ErrorAlert } from './ui';

const GITHUB = 'https://github.com/';

/** Clear completion / error screens for a finished deployment. */
export function RunOutcome({ result, owner, repo, branch, recordId, onRetry, onNew }: {
  result: DeployResult; owner: string; repo: string; branch: string; recordId?: string; onRetry: () => void; onNew: () => void;
}) {
  const commitOk = !!result.commitUrl?.startsWith(GITHUB);
  const actions = (
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {result.status === 'success' && commitOk && (
        <a href={result.commitUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md', 'w-full sm:w-auto')}>
          <span className="font-mono text-xs">{result.commitSha?.slice(0, 7)}</span> View commit on GitHub<ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      )}
      {result.status !== 'failed' && result.status !== 'cancelled' && <a href={repoUrl(owner, repo, branch)} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', 'w-full sm:w-auto')}>Open branch<ExternalLink className="h-4 w-4" aria-hidden /></a>}
      {recordId && <Link to={`/history/${recordId}`} className={buttonClass('secondary', 'md', 'w-full sm:w-auto')}>View details</Link>}
      {result.status !== 'success' && <Button className="w-full sm:w-auto" onClick={onRetry}>{result.status === 'failed' ? 'Try again' : 'Back to review'}</Button>}
      <Link to="/new" onClick={onNew} className={buttonClass(result.status === 'success' ? 'secondary' : 'ghost', 'md', 'w-full sm:w-auto')}>New deployment</Link>
    </div>
  );

  if (result.status === 'success') {
    const c = result.counts;
    return (
      <div role="status" className="rounded-xl border border-success/40 bg-success/10 p-4 sm:p-5">
        <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-success" aria-hidden />
          <div className="min-w-0"><h3 className="text-lg font-semibold">Deployment complete</h3>
            <p className="mt-1 text-sm text-muted">{plural(c.added, 'file')} added, {c.updated} updated, {c.deleted} deleted{c.unchanged ? `, ${c.unchanged} unchanged` : ''}{c.skipped ? `, ${c.skipped} skipped` : ''} — in one commit on <span className="break-words font-mono text-xs">{branch}</span>.</p></div></div>
        {actions}
      </div>
    );
  }
  if (result.status === 'no-changes') {
    return <div role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-4 sm:p-5"><div className="flex items-start gap-3"><MinusCircle className="mt-0.5 h-7 w-7 shrink-0 text-accent-fg" aria-hidden /><div><h3 className="text-lg font-semibold">No changes</h3><p className="mt-1 text-sm text-muted">The branch already matches the archive. No commit was created.</p></div></div>{actions}</div>;
  }
  if (result.status === 'cancelled') {
    return <div role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-4 sm:p-5"><div className="flex items-start gap-3"><Slash className="mt-0.5 h-7 w-7 shrink-0 text-warn" aria-hidden /><div><h3 className="text-lg font-semibold">Deployment cancelled</h3><p className="mt-1 text-sm text-muted">Nothing was committed; the branch is unchanged.</p></div></div>{actions}</div>;
  }
  return <div className="space-y-1">{result.error && <ErrorAlert error={result.error} />}{actions}</div>;
}
