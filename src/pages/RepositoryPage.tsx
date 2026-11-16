import { ArrowRight, Archive, ExternalLink, GitBranch, Globe, Lock, Plus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreateBranchForm, CreateRepoForm } from '../components/RepoForms';
import { StepNav } from '../components/StepNav';
import { DeployConfigForm } from '../components/DeployConfigForm';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorAlert, Field, PageHeader, Spinner, buttonClass, cx, inputClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDraft } from '../contexts/DraftContext';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { listBranches, listRepositories } from '../services/github';
import type { Branch, Repo } from '../types';
import { validateConfig } from '../utils/config';
import { formatDateTime } from '../utils/format';

const isGitHubUrl = (u: string) => u.startsWith('https://github.com/');

export function RepositoryPage() {
  useDocumentTitle('Choose repository');
  const { github, user } = useAuth();
  const { archive, repo, setRepo, branch, setBranch, config, setConfig } = useDraft();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<Repo[]>([]);
  const [extraBranches, setExtraBranches] = useState<Branch[]>([]);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);

  const repos = useAsync((signal) => listRepositories(github, { signal }), [github]);
  const all = useMemo(() => {
    const seen = new Set(added.map((r) => r.id));
    return [...added, ...(repos.data?.repos ?? []).filter((r) => !seen.has(r.id))];
  }, [added, repos.data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => `${r.fullName} ${r.description ?? ''}`.toLowerCase().includes(q)) : all;
  }, [all, query]);

  useEffect(() => {
    const want = params.get('repo')?.toLowerCase();
    if (!want) return;
    const r = all.find((x) => x.fullName.toLowerCase() === want);
    if (r && r.id !== repo?.id) setRepo(r);
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const branches = useAsync((signal) => (repo ? listBranches(github, repo.owner, repo.name, signal) : Promise.resolve<Branch[]>([])), [github, repo?.id]);
  const branchList = useMemo(() => {
    const base = branches.data ?? [];
    return [...base, ...extraBranches.filter((b) => !base.some((x) => x.name === b.name))];
  }, [branches.data, extraBranches]);
  useEffect(() => { setExtraBranches([]); setCreatingBranch(false); }, [repo?.id]);
  useEffect(() => {
    if (repo && branches.status === 'success' && !branch) setBranch(branchList.find((b) => b.name === repo.defaultBranch)?.name ?? branchList[0]?.name);
  }, [repo, branches.status, branch, branchList, setBranch]);

  const selectedBranch = branchList.find((b) => b.name === branch);
  const problems = validateConfig(config);
  const reason = !archive ? 'Add a ZIP archive first.' : archive.inspection.blocking ? 'The archive has blocking errors.' : !repo ? 'Choose a repository.' : repo.archived ? 'Archived repositories are read-only.' : !repo.canPush ? 'You do not have push access to this repository.' : !branch ? 'Choose a branch.' : problems.targetDir || problems.message ? 'Fix the deployment settings.' : null;

  return (
    <>
      <PageHeader title="Choose a destination" description="Pick the repository and branch to deploy to." />
      <StepNav current={1} reached={archive && !archive.inspection.blocking ? 2 : 0} />
      {!archive && <div className="mb-4"><Alert tone="warn" title="No ZIP archive selected" action={<Link to="/new" className={buttonClass('secondary', 'sm')}>Add archive</Link>}>You can browse repositories, but you need an archive to continue.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex flex-col">
          <CardHeader title="Your repositories" action={<div className="flex gap-2"><Button size="sm" aria-label="Refresh repositories" onClick={repos.reload}><RefreshCw className="h-4 w-4" aria-hidden /></Button><Button size="sm" variant="primary" onClick={() => setCreatingRepo(true)}><Plus className="h-4 w-4" aria-hidden />New</Button></div>} />
          <div className="space-y-3 p-4">
            {creatingRepo && user && <CreateRepoForm github={github} login={user.login} onCancel={() => setCreatingRepo(false)} onCreated={(r) => { setAdded((a) => [r, ...a]); setRepo(r); setCreatingRepo(false); }} />}
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden /><input type="search" aria-label="Search repositories" placeholder="Search repositories" value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputClass, 'pl-9')} /></div>
            {repos.status === 'error' && <ErrorAlert error={repos.error} onRetry={repos.reload} />}
            {repos.status === 'loading' && !repos.data && <Spinner label="Loading repositories" />}
            {repos.data?.truncated && <p className="text-xs text-muted">Showing the {all.length} most recently updated repositories. Use search to narrow them down.</p>}
          </div>
          {repos.status !== 'loading' || repos.data ? (
            filtered.length === 0 && repos.status === 'success' ? <EmptyState icon={Search} title={query ? 'No repositories match' : 'No repositories found'}>{query ? 'Try a different search.' : 'Create a repository to deploy into.'}</EmptyState> : (
              <ul aria-label="Repositories" className="max-h-[32rem] divide-y divide-border overflow-auto border-t border-border">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button type="button" aria-pressed={repo?.id === r.id} onClick={() => setRepo(r)} className={cx('block w-full min-w-0 px-4 py-3 text-left hover:bg-secondary/60', repo?.id === r.id && 'bg-accent/10')}>
                      <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{r.fullName}</span>{r.private ? <Badge icon={Lock}>Private</Badge> : <Badge icon={Globe}>Public</Badge>}</span>
                      {r.description && <span className="mt-0.5 block truncate text-xs text-muted">{r.description}</span>}
                      <span className="mt-1 flex flex-wrap gap-1.5">{r.archived && <Badge tone="warn" icon={Archive}>Archived</Badge>}{!r.canPush && <Badge tone="danger">No push access</Badge>}{r.fork && <Badge>Fork</Badge>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Destination" />
            {!repo ? <EmptyState icon={GitBranch} title="No repository selected">Choose a repository from the list.</EmptyState> : (
              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1"><p className="break-all text-lg font-semibold">{repo.fullName}</p>{repo.description && <p className="mt-1 break-words text-sm text-muted">{repo.description}</p>}</div>
                  {repo.private ? <Badge icon={Lock}>Private</Badge> : <Badge icon={Globe}>Public</Badge>}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"><dt className="text-muted">Owner</dt><dd>{repo.owner}</dd><dt className="text-muted">Default branch</dt><dd className="font-mono text-xs leading-5">{repo.defaultBranch}</dd>{repo.updatedAt && <><dt className="text-muted">Last push</dt><dd>{formatDateTime(repo.updatedAt)}</dd></>}</dl>
                {isGitHubUrl(repo.htmlUrl) && <a href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" className="tap gap-1 text-sm text-accent-fg hover:underline">View on GitHub<ExternalLink className="h-3 w-3" aria-hidden /></a>}
                {repo.archived && <Alert tone="danger" title="This repository is archived">Archived repositories are read-only on GitHub.</Alert>}
                {!repo.canPush && !repo.archived && <Alert tone="danger" title="No push access">Your GitHub account cannot write to this repository.</Alert>}

                <div className="space-y-3 border-t border-border pt-4">
                  <Field label="Branch">
                    {(id) => (
                      <select id={id} value={branch ?? ''} disabled={branches.status === 'loading' && !branches.data} onChange={(e) => setBranch(e.target.value)} className={inputClass}>
                        {!branch && <option value="">Select a branch</option>}
                        {branchList.map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>)}
                      </select>
                    )}
                  </Field>
                  {branches.status === 'loading' && !branches.data && <Spinner label="Loading branches" />}
                  {branches.status === 'error' && <ErrorAlert error={branches.error} onRetry={branches.reload} />}
                  {branches.status === 'success' && branchList.length === 0 && <Alert tone="warn" title="This repository has no branches">It is empty. Create a first commit on GitHub (for example a README), then reload.</Alert>}
                  {selectedBranch?.protected && <Alert tone="warn" title="Protected branch">GitHub may reject a direct push to this branch. Create a new branch if the deployment is refused.</Alert>}
                  {creatingBranch && branchList.length > 0 ? <CreateBranchForm github={github} repo={repo} branches={branchList} defaultFrom={branch ?? branchList[0].name} onCancel={() => setCreatingBranch(false)} onCreated={(name) => { setExtraBranches((x) => [...x, { name, sha: '', protected: false }]); setBranch(name); setCreatingBranch(false); }} />
                    : <Button size="sm" disabled={branchList.length === 0} onClick={() => setCreatingBranch(true)}><GitBranch className="h-4 w-4" aria-hidden />New branch</Button>}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Deployment configuration" description="Where in the repository the files go, and how existing files are handled." />
            <div className="p-4 sm:p-5"><DeployConfigForm config={config} onChange={setConfig} /></div>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {reason && <p className="text-sm text-muted">{reason}</p>}
            {reason ? <Button variant="primary" size="lg" disabled>Continue to review</Button> : <Link to="/new/workspace" className={buttonClass('primary', 'lg')}>Continue to review <ArrowRight className="h-5 w-5" aria-hidden /></Link>}
          </div>
        </div>
      </div>
    </>
  );
}
