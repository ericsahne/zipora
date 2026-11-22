import { Download, ExternalLink, History, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, Button, Card, EmptyState, ErrorAlert, PageHeader, buttonClass, cx, inputClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHistory } from '../hooks/useHistory';
import { buildHistoryZip, downloadBlob } from '../services/export';
import { formatDateTime, formatRelative, plural } from '../utils/format';

export function HistoryPage() {
  useDocumentTitle('History');
  const { user } = useAuth();
  const { records, clear, remove } = useHistory();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [repo, setRepo] = useState('all');
  const [sort, setSort] = useState<'new' | 'old'>('new');
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmId, setConfirmId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>();

  const repos = useMemo(() => [...new Set(records.map((r) => `${r.owner}/${r.repo}`))].sort(), [records]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = records.filter((r) => (status === 'all' || r.status === status) && (repo === 'all' || `${r.owner}/${r.repo}` === repo)
      && (!needle || `${r.owner}/${r.repo} ${r.branch} ${r.message} ${r.commitSha ?? ''} ${r.archiveName}`.toLowerCase().includes(needle)));
    return sort === 'new' ? list : [...list].reverse();
  }, [records, q, status, repo, sort]);

  const exportZip = async () => {
    setExporting(true); setExportError(undefined);
    try { downloadBlob(`zipora-history-${new Date().toISOString().slice(0, 10)}.zip`, await buildHistoryZip(records, user?.login ?? 'unknown')); }
    catch (e) { setExportError(e); }
    finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Deployment history" description="Deployments made from this browser with your GitHub account." />
      <div className="mb-4"><Alert tone="info" title="History is stored only in this browser">It is kept under your GitHub account on this device (not on a server), so other devices and browsers will not show it. Use Export to keep a copy.</Alert></div>

      {records.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void exportZip()} loading={exporting}><Download className="h-4 w-4" aria-hidden />Export (ZIP)</Button>
          {!confirmAll && <Button variant="danger" size="sm" onClick={() => setConfirmAll(true)}><Trash2 className="h-4 w-4" aria-hidden />Clear history</Button>}
        </div>
      )}
      {exportError !== undefined && <div className="mb-4"><ErrorAlert error={exportError} /></div>}
      {confirmAll && <div className="mb-4"><Alert tone="danger" title={`Delete all ${plural(records.length, 'record')}?`} action={<div className="flex gap-2"><Button size="sm" variant="danger" onClick={() => { clear(); setConfirmAll(false); }}>Delete</Button><Button size="sm" onClick={() => setConfirmAll(false)}>Keep</Button></div>}>This removes the local records only. Commits already made on GitHub are not affected.</Alert></div>}

      {records.length === 0 ? (
        <Card><EmptyState icon={History} title="No deployments yet" action={<Link to="/new" className={buttonClass('primary', 'md')}>New deployment</Link>}>Each deployment you run appears here with its commit, counts and full logs.</EmptyState></Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="relative col-span-2 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" aria-hidden /><input type="search" aria-label="Search history" placeholder="Search repository, branch, message or commit" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputClass, 'pl-9')} /></div>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={cx(inputClass, 'lg:w-auto')}>
              <option value="all">All statuses</option><option value="success">Deployed</option><option value="failed">Failed</option><option value="no-changes">No changes</option><option value="cancelled">Cancelled</option>
            </select>
            <select aria-label="Filter by repository" value={repo} onChange={(e) => setRepo(e.target.value)} className={cx(inputClass, 'lg:w-auto')}>
              <option value="all">All repositories</option>{repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select aria-label="Sort order" value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'old')} className={cx(inputClass, 'col-span-2 lg:col-span-1 lg:w-auto')}><option value="new">Newest first</option><option value="old">Oldest first</option></select>
          </div>
          <p role="status" className="mb-2 text-sm text-muted">{plural(shown.length, 'deployment')}{shown.length !== records.length ? ` of ${records.length}` : ''}</p>
          <Card>
            {shown.length === 0 ? <p className="p-6 text-center text-sm text-muted">No deployments match your filters.</p> : (
              <ul className="divide-y divide-border">
                {shown.map((r) => (
                  <li key={r.id} className="p-3 sm:px-5 sm:py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <Link to={`/history/${r.id}`} className="min-w-0 flex-1 rounded-lg p-1 hover:bg-secondary/50">
                        <p className="truncate font-medium">{r.owner}/{r.repo} <span className="font-normal text-muted">@ {r.branch}</span></p>
                        <p className="truncate text-sm text-muted">{r.message}</p>
                        <p className="text-xs text-muted"><time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</time> · {plural(r.fileCount, 'file')}{r.commitSha && <> · <span className="font-mono">{r.commitSha.slice(0, 7)}</span></>}</p>
                      </Link>
                      {confirmId === r.id ? (
                        <div className="flex items-center gap-2"><span className="text-sm">Delete this record?</span><Button size="sm" variant="danger" aria-label={`Confirm delete: ${r.message}`} onClick={() => { remove(r.id); setConfirmId(undefined); }}>Delete</Button><Button size="sm" onClick={() => setConfirmId(undefined)}>Keep</Button></div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          {r.commitUrl?.startsWith('https://github.com/') && <a href={r.commitUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open commit ${r.commitSha?.slice(0, 7)} on GitHub`} className={buttonClass('ghost', 'sm', 'w-11 px-0')}><ExternalLink className="h-4 w-4" aria-hidden /></a>}
                          <Button size="sm" variant="ghost" aria-label={`Delete record: ${r.message}`} className="w-11 px-0" onClick={() => setConfirmId(r.id)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
