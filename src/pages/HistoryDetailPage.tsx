import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LogViewer } from '../components/DeploymentProgress';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, Button, Card, CardHeader, ErrorAlert, PageHeader, buttonClass } from '../components/ui';
import { EngineError } from '../engine';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHistory } from '../hooks/useHistory';
import { formatDateTime, formatDuration, plural, repoUrl } from '../utils/format';
import { safeName } from '../utils/safeName';

export function HistoryDetailPage() {
  useDocumentTitle('Deployment details');
  const { id } = useParams();
  const { store, remove } = useHistory();
  const navigate = useNavigate();
  const r = id ? store?.get(id) : undefined;
  if (!r) {
    return <><PageHeader title="Deployment not found" /><Alert tone="warn" title="This record does not exist in this browser" action={<Link to="/history" className={buttonClass('secondary', 'sm')}>Back to history</Link>}>It may have been deleted, or it was created on another device.</Alert></>;
  }
  const commitOk = r.commitUrl?.startsWith('https://github.com/');
  return (
    <>
      <Link to="/history" className="tap mb-2 gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden />History</Link>
      <PageHeader title={`${r.owner}/${r.repo}`} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /><span>{formatDateTime(r.createdAt)}</span></span>}
        action={<Button variant="danger" size="sm" onClick={() => { remove(r.id); navigate('/history'); }}><Trash2 className="h-4 w-4" aria-hidden />Delete record</Button>} />
      <div className="space-y-6">
        {r.error && <ErrorAlert error={new EngineError(r.error.code as never, r.error.message, { hint: r.error.hint })} />}
        <Card>
          <CardHeader title="Details" />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 p-5 text-sm">
            <dt className="text-muted">Repository</dt><dd className="break-all"><a href={repoUrl(r.owner, r.repo, r.branch)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">{r.owner}/{r.repo}<ExternalLink className="h-3 w-3" aria-hidden /></a></dd>
            <dt className="text-muted">Branch</dt><dd className="break-all font-mono text-xs leading-5">{r.branch}</dd>
            <dt className="text-muted">Target</dt><dd className="break-all font-mono text-xs leading-5">{r.targetDir || '/ (repository root)'}</dd>
            <dt className="text-muted">Commit message</dt><dd className="break-words">{r.message}</dd>
            <dt className="text-muted">Archive</dt><dd className="break-all">{safeName(r.archiveName)} · {plural(r.fileCount, 'file')}</dd>
            <dt className="text-muted">Result</dt><dd>{r.counts.added} added · {r.counts.updated} updated · {r.counts.unchanged} unchanged · {r.counts.skipped} skipped · {r.counts.deleted} deleted · {r.counts.failed} failed</dd>
            <dt className="text-muted">Duration</dt><dd>{formatDuration(r.durationMs)}</dd>
            {r.commitSha && <><dt className="text-muted">Commit</dt><dd className="break-all font-mono text-xs leading-5">{commitOk ? <a href={r.commitUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">{r.commitSha}<ExternalLink className="h-3 w-3" aria-hidden /></a> : r.commitSha}</dd></>}
          </dl>
        </Card>
        <LogViewer logs={r.logs} name={`zipora-${r.owner}-${r.repo}-${r.createdAt.slice(0, 10)}`} />
      </div>
    </>
  );
}
