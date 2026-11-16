import { ExternalLink, History, Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Brand';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, buttonClass } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHistory } from '../hooks/useHistory';
import { formatDateTime } from '../utils/format';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { user, scope, sessionExpiresAt } = useAuth();
  const { records } = useHistory();
  if (!user) return null;
  const count = (s: string) => records.filter((r) => r.status === s).length;
  const shortcuts = [...new Map(records.map((r) => [`${r.owner}/${r.repo}`, r])).values()].slice(0, 5);

  return (
    <>
      <PageHeader title={`Welcome, ${user.name ?? user.login}`} description="Deploy a ZIP archive to GitHub in a few steps." action={<Link to="/new" className={buttonClass('primary')}><Rocket className="h-4 w-4" aria-hidden />New deployment</Link>} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total deployments" value={records.length} caption={records.length ? `${count('no-changes')} unchanged · ${count('cancelled')} cancelled` : 'Nothing deployed from this browser yet'} />
        <Stat label="Successful" value={count('success')} caption="Deployments that created a commit" />
        <Stat label="Failed" value={count('failed')} caption="Nothing is committed on failure" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Recent activity" description="Stored in this browser for your GitHub account." action={records.length > 0 ? <Link to="/history" className="tap text-sm text-accent-fg hover:underline">View all</Link> : undefined} />
          {records.length === 0 ? (
            <EmptyState icon={History} title="No deployments yet" action={<Link to="/new" className={buttonClass('primary', 'sm')}>Start your first deployment</Link>}>Deployments you run will be listed here with their commit and logs.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {records.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link to={`/history/${r.id}`} className="flex min-w-0 items-center gap-3 px-5 py-3 hover:bg-secondary/50">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.owner}/{r.repo} <span className="font-normal text-muted">@ {r.branch}</span></p><p className="truncate text-xs text-muted">{r.message} · {formatDateTime(r.createdAt)}</p></div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Connected account" />
            <div className="flex items-center gap-3 p-4 sm:p-5">
              <Avatar src={user.avatarUrl} login={user.login} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{user.name ?? user.login}</p>
                <a href={`https://github.com/${encodeURIComponent(user.login)}`} target="_blank" rel="noopener noreferrer" className="tap gap-1 text-sm text-muted hover:text-fg">@{user.login}<ExternalLink className="h-3 w-3" aria-hidden /></a>
              </div>
              <Badge tone="success">Connected</Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border px-5 py-4 text-sm">
              <dt className="text-muted">Permissions</dt><dd className="break-words">{scope || 'Granted by the GitHub App'}</dd>
              {sessionExpiresAt && <><dt className="text-muted">Session until</dt><dd>{formatDateTime(sessionExpiresAt)}</dd></>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Repository shortcuts" description="Repositories you deployed to recently." />
            {shortcuts.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Repositories will appear here after your first deployment.</p> : (
              <ul className="divide-y divide-border">
                {shortcuts.map((r) => (
                  <li key={`${r.owner}/${r.repo}`}><Link to={`/new/repository?repo=${encodeURIComponent(`${r.owner}/${r.repo}`)}`} className="block truncate px-5 py-3 text-sm hover:bg-secondary/50">{r.owner}/{r.repo}</Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
