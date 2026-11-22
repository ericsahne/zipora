import { Eye, FilePlus2, FileX2, FileDiff, Rocket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeployConfigForm } from '../components/DeployConfigForm';
import { DeploymentProgress } from '../components/DeploymentProgress';
import { RepoDiagnostics } from '../components/RepoDiagnostics';
import { RunOutcome } from '../components/RunOutcome';
import { StepNav } from '../components/StepNav';
import { Alert, Badge, Button, Card, CardHeader, ErrorAlert, PageHeader, buttonClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDraft } from '../contexts/DraftContext';
import { EngineError, planDeployment, type DeployPlan } from '../engine';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { describeError } from '../services/errors';
import { validateConfig } from '../utils/config';
import { formatBytes, plural } from '../utils/format';
import { safeName } from '../utils/safeName';

export function WorkspacePage() {
  useDocumentTitle('Review and deploy');
  const { github } = useAuth();
  const { archive, repo, branch, config, setConfig, run, startDeployment, cancelDeployment, resetRun, resetAll } = useDraft();
  const [preview, setPreview] = useState<DeployPlan>();
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>();
  const runRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Starting: glide to the progress card. Finished: jump (instantly, after layout settles) so the outcome and its primary action are on screen.
    if (run.phase === 'running') {
      runRef.current?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } else if (run.phase === 'done') {
      const id = requestAnimationFrame(() => runRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }));
      return () => cancelAnimationFrame(id);
    }
  }, [run.phase]);

  if (!archive || !repo || !branch) {
    return (
      <>
        <PageHeader title="Review and deploy" />
        <Alert tone="warn" title="Nothing to deploy yet" action={<Link to={archive ? '/new/repository' : '/new'} className={buttonClass('secondary', 'sm')}>{archive ? 'Choose destination' : 'Add archive'}</Link>}>
          {archive ? 'Choose a repository and branch first.' : 'Add a ZIP archive first.'}
        </Alert>
      </>
    );
  }

  const files = archive.inspection.files;
  const problems = validateConfig(config);
  const invalid = !!(problems.targetDir || problems.message) || archive.inspection.blocking || files.length === 0 || repo.archived || !repo.canPush;
  const locked = run.phase !== 'idle';
  const result = run.result;
  const last = run.events.at(-1);
  const canCancel = run.phase === 'running' && !(last && ['commit', 'branch', 'complete'].includes(last.stage));

  const doPreview = async () => {
    setPreviewing(true); setPreviewError(undefined); setPreview(undefined);
    try {
      const head = await github.getBranch(repo.owner, repo.name, branch);
      const { entries, truncated } = await github.getTree(repo.owner, repo.name, head.treeSha);
      if (truncated) throw new EngineError('TREE_TRUNCATED', 'This repository is too large for GitHub to list in one request, so files cannot be compared safely.', { hint: 'Deploy into a smaller repository or branch.' });
      setPreview(await planDeployment(files, entries, { targetDir: config.targetDir, replaceExisting: config.replaceExisting, deleteMissing: config.deleteMissing }));
    } catch (e) {
      setPreviewError(e);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      <PageHeader title="Review and deploy" description="Check everything, preview the changes, then deploy for real." />
      <StepNav current={2} reached={2} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={`min-w-0 space-y-6 ${locked ? 'order-2 lg:order-1' : ''}`}>
          <Card>
            <CardHeader title="Summary" action={<Link to="/new/repository" className="tap text-sm text-accent-fg hover:underline">Change</Link>} />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 p-5 text-sm">
              <dt className="text-muted">Archive</dt><dd className="break-all">{safeName(archive.name)} · {plural(files.length, 'file')} · {formatBytes(archive.inspection.totalBytes)}</dd>
              <dt className="text-muted">Repository</dt><dd className="break-all">{repo.fullName} <Badge>{repo.private ? 'Private' : 'Public'}</Badge></dd>
              <dt className="text-muted">Branch</dt><dd className="break-all font-mono text-xs leading-5">{branch}</dd>
              <dt className="text-muted">Target</dt><dd className="break-all font-mono text-xs leading-5">{config.targetDir.trim() || '/ (repository root)'}</dd>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Configuration" />
            <div className="p-4 sm:p-5"><DeployConfigForm config={config} onChange={(p) => { setConfig(p); setPreview(undefined); }} disabled={locked} /></div>
          </Card>
        </div>

        <div ref={runRef} className={`min-w-0 space-y-6 ${locked ? 'order-1 lg:order-2' : ''}`}>
          {run.phase === 'idle' && (
            <Card>
              <CardHeader title="Preview changes" description="Compares your archive with the current branch. Nothing is written." action={<Button size="sm" onClick={() => void doPreview()} loading={previewing} disabled={invalid}><Eye className="h-4 w-4" aria-hidden />Preview changes</Button>} />
              <div className="space-y-4 p-4 sm:p-5">
                {previewError !== undefined && <ErrorAlert error={previewError} onRetry={() => void doPreview()} />}
                {!preview && !previewError && <p className="text-sm text-muted">Run a preview to see which files will be added, changed or deleted.</p>}
                {preview && (
                  <div aria-label="Preview result" className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="success" icon={FilePlus2}>{plural(preview.add.length, 'new file')}</Badge><Badge tone="accent" icon={FileDiff}>{plural(preview.update.length, 'changed file')}</Badge>
                      <Badge>{plural(preview.unchanged.length, 'unchanged file')}</Badge>{preview.skippedExisting.length > 0 && <Badge tone="warn">{plural(preview.skippedExisting.length, 'skipped file')}</Badge>}
                      {preview.delete.length > 0 && <Badge tone="danger" icon={FileX2}>{plural(preview.delete.length, 'deletion')}</Badge>}
                    </div>
                    {preview.warnings.map((w) => <Alert key={w} tone="warn">{safeName(w)}</Alert>)}
                    {[['New', preview.add.map((f) => f.path)], ['Changed', preview.update.map((f) => f.path)], ['Deleted', preview.delete], ['Skipped (replace is off)', preview.skippedExisting]].map(([label, list]) => (list as string[]).length > 0 && (
                      <details key={label as string} className="rounded-lg border border-border bg-bg"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">{label as string} ({(list as string[]).length})</summary>
                        <ul className="max-h-48 overflow-auto border-t border-border px-3 py-2 font-mono text-xs leading-5">{(list as string[]).slice(0, 200).map((p) => <li key={p} className="break-all">{safeName(p)}</li>)}{(list as string[]).length > 200 && <li className="text-muted">…and {(list as string[]).length - 200} more</li>}</ul></details>
                    ))}
                    {preview.add.length + preview.update.length + preview.delete.length === 0 && <Alert tone="info">The branch already matches this archive; deploying would create no commit.</Alert>}
                    <p className="text-xs text-muted">The branch may change before you deploy; the deployment re-checks and rebases automatically.</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={run.phase === 'idle' ? 'Deploy' : run.phase === 'running' ? `Deploying to ${repo.fullName}` : 'Result'} description={run.phase === 'idle' ? 'Creates one commit on the selected branch.' : undefined} />
            <div className="space-y-5 p-4 sm:p-5">
              {run.phase === 'idle' && (
                <>
                  {invalid && <Alert tone="warn" title="Fix these before deploying">{[problems.targetDir, problems.message, archive.inspection.blocking && 'The archive has blocking errors.', repo.archived && 'The repository is archived.', !repo.canPush && 'You do not have push access.'].filter(Boolean).join(' ')}</Alert>}
                  <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={invalid} onClick={() => void startDeployment()}><Rocket className="h-5 w-5" aria-hidden />Deploy to {branch}</Button>
                </>
              )}
              {result && <RunOutcome result={result} owner={repo.owner} repo={repo.name} branch={branch} recordId={run.recordId} onRetry={resetRun} onNew={resetAll} />}
              {result?.status === 'failed' && ['NOT_FOUND', 'PERMISSION', 'AUTH'].includes(result.error?.code ?? '') && <RepoDiagnostics repo={repo.fullName} />}
              {run.phase !== 'idle' && <DeploymentProgress events={run.events} result={result} />}
              {run.phase === 'running' && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button variant="danger" className="w-full sm:w-auto" disabled={!canCancel} onClick={cancelDeployment}>Cancel deployment</Button>
                  {!canCancel && <span className="text-xs text-muted">Cancelling is no longer possible: the commit is being written.</span>}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
