import { ArrowRight, FileArchive, RefreshCw, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DropZone } from '../components/DropZone';
import { FileExplorer } from '../components/FileExplorer';
import { StepNav } from '../components/StepNav';
import { Alert, Badge, Button, Card, CardHeader, ErrorAlert, PageHeader, Stat, buttonClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDraft } from '../contexts/DraftContext';
import { DEFAULT_LIMITS, EngineError, inspectZip } from '../engine';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { readFileBytes, summarize } from '../services/zip';
import { formatBytes, plural } from '../utils/format';
import { safeName } from '../utils/safeName';

export function NewDeploymentPage() {
  useDocumentTitle('New deployment');
  const { client } = useAuth();
  const { archive, setArchive, run } = useDraft();
  const [busy, setBusy] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<unknown>();
  const [note, setNote] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  const onFile = async (file: File, dropped: number) => {
    setError(undefined);
    setNote(dropped > 1 ? 'Only one archive can be deployed at a time; the first file was used.' : undefined);
    if (file.size > DEFAULT_LIMITS.maxArchiveBytes) {
      setArchive(undefined);
      setError(new EngineError('ARCHIVE_TOO_LARGE', `Archive is ${formatBytes(file.size)}; the limit is ${formatBytes(DEFAULT_LIMITS.maxArchiveBytes)}.`, { hint: 'Split the project into several smaller archives and deploy them one at a time.' }));
      return;
    }
    setBusy({ done: 0, total: 0 });
    try {
      const bytes = await readFileBytes(file);
      const inspection = await inspectZip(bytes, { limits: client.zipLimits(), onProgress: (done, total) => setBusy({ done, total }) });
      setArchive({ name: file.name, size: file.size, inspection });
    } catch (e) {
      setArchive(undefined);
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  const s = archive ? summarize(archive.inspection) : undefined;
  const issues = archive?.inspection.issues ?? [];
  const shown = showAll ? issues : issues.slice(0, 8);
  const blocked = !archive || archive.inspection.blocking || archive.inspection.files.length === 0;

  return (
    <>
      <PageHeader title="New deployment" description="Add the ZIP archive you want to deploy." />
      <StepNav current={0} reached={archive && !blocked ? 1 : 0} />
      {run.phase === 'running' && <div className="mb-4"><Alert tone="info" title="A deployment is running" action={<Link to="/new/workspace" className={buttonClass('secondary', 'sm')}>View</Link>}>Starting a new archive will not stop it.</Alert></div>}

      {!archive && (
        <div className="space-y-4">
          <DropZone onFile={(f, n) => void onFile(f, n)} busy={!!busy} />
          {busy && busy.total > 0 && <p role="status" className="text-center text-sm text-muted">Verifying files… {busy.done} of {busy.total}</p>}
          {note && <Alert tone="warn">{note}</Alert>}
          {error !== undefined && <ErrorAlert error={error} />}
          <p className="text-center text-xs text-muted">Limits: {formatBytes(DEFAULT_LIMITS.maxArchiveBytes)} per archive, {DEFAULT_LIMITS.maxFiles.toLocaleString()} files, {formatBytes(client.zipLimits().maxFileBytes ?? 0)} per file.</p>
        </div>
      )}

      {archive && s && (
        <div className="space-y-6">
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-fg"><FileArchive className="h-5 w-5" aria-hidden /></span>
              <div className="min-w-0 flex-1"><p className="break-all font-medium">{safeName(archive.name)}</p><p className="text-sm text-muted">{formatBytes(archive.size)} compressed</p></div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
            <label className={buttonClass('secondary', 'sm', 'cursor-pointer')}><RefreshCw className="h-4 w-4" aria-hidden />Replace<input type="file" accept=".zip,application/zip" className="sr-only" aria-label="Replace the archive" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f, 1); }} /></label>
            <Button size="sm" variant="danger" onClick={() => { setArchive(undefined); setError(undefined); }}><Trash2 className="h-4 w-4" aria-hidden />Remove</Button>
            </div>
          </Card>
          {busy && <p role="status" className="text-sm text-muted">Replacing archive…</p>}
          {error !== undefined && <ErrorAlert error={error} />}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Files" value={s.files.toLocaleString()} /><Stat label="Folders" value={s.dirs.toLocaleString()} />
            <Stat label="Extracted size" value={formatBytes(s.bytes)} /><Stat label="Issues" value={s.errors + s.warnings} caption={`${s.errors} errors · ${s.warnings} warnings`} />
          </div>

          {archive.inspection.blocking && <Alert tone="danger" title="This archive cannot be deployed as it is">Fix the errors below, create the ZIP again, and replace it.</Alert>}
          {archive.inspection.files.length === 0 && !archive.inspection.blocking && <Alert tone="warn" title="The archive contains no deployable files" />}
          {issues.length > 0 && (
            <Card>
              <CardHeader title="Validation results" />
              <ul className="divide-y divide-border">
                {shown.map((i, n) => (
                  <li key={n} className="flex gap-3 px-5 py-3 text-sm">
                    {i.severity === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />}
                    <div className="min-w-0"><p className="break-words">{safeName(i.message)}</p><Badge tone={i.severity === 'error' ? 'danger' : 'warn'}>{i.code}</Badge></div>
                  </li>
                ))}
              </ul>
              {issues.length > 8 && <div className="border-t border-border px-5 py-3"><button type="button" onClick={() => setShowAll(!showAll)} className="text-sm text-accent-fg hover:underline">{showAll ? 'Show fewer' : `Show all ${plural(issues.length, 'issue')}`}</button></div>}
            </Card>
          )}

          <Card>
            <CardHeader title="Archive contents" description="Names are shown as text; invisible characters are made visible." />
            <div className="p-4 sm:p-5"><FileExplorer files={archive.inspection.files} emptyDirs={archive.inspection.emptyDirs} /></div>
          </Card>

          <div className="flex justify-end">
            {blocked ? <Button variant="primary" size="lg" disabled>Continue to repository</Button> : <Link to="/new/repository" className={buttonClass('primary', 'lg')}>Continue to repository <ArrowRight className="h-5 w-5" aria-hidden /></Link>}
          </div>
        </div>
      )}
    </>
  );
}
