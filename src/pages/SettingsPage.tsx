import { Check, Download, LogOut, Monitor, Moon, Sun, Trash2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../components/Brand';
import { Badge, Button, Card, CardHeader, Field, PageHeader, cx, inputClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { usePrefs } from '../contexts/PreferencesContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHistory } from '../hooks/useHistory';
import { useSignOut } from '../hooks/useSignOut';
import { buildHistoryZip, downloadBlob } from '../services/export';
import type { ThemePreference } from '../types';
import { formatDateTime, plural } from '../utils/format';

const THEMES: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [{ value: 'dark', label: 'Dark', icon: Moon }, { value: 'light', label: 'Light', icon: Sun }, { value: 'system', label: 'System', icon: Monitor }];

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
      <span><span className="font-medium">{label}</span><span className="block text-muted">{description}</span></span>
    </label>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { user, scope, sessionExpiresAt } = useAuth();
  const { prefs, setPrefs } = usePrefs();
  const { records, clear } = useHistory();
  const signOut = useSignOut();
  const [msg, setMsg] = useState(prefs.defaultCommitMessage);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const msgOk = msg.trim().length > 0 && msg.length <= 200;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardHeader title="Appearance" description="Saved in this browser." />
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 p-4 sm:p-5">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={prefs.theme === value} onClick={() => setPrefs({ theme: value })}
                className={cx('flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-medium', prefs.theme === value ? 'border-accent bg-accent/10 text-accent-fg' : 'border-border bg-secondary text-muted hover:text-fg')}>
                <Icon className="h-4 w-4" aria-hidden />{label}{prefs.theme === value && <Check className="h-3.5 w-3.5" aria-hidden />}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="GitHub account" />
          {user && (
            <div className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-3"><Avatar src={user.avatarUrl} login={user.login} size={48} /><div className="min-w-0 flex-1"><p className="truncate font-medium">{user.name ?? user.login}</p><p className="truncate text-sm text-muted">@{user.login}</p></div><Badge tone="success">Connected</Badge></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm"><dt className="text-muted">Permissions</dt><dd className="break-words">{scope || 'Granted by the GitHub App'}</dd>{sessionExpiresAt && <><dt className="text-muted">Session ends</dt><dd>{formatDateTime(sessionExpiresAt)}</dd></>}</dl>
              <p className="text-sm text-muted">Signing out revokes ZIPORA&apos;s access token on GitHub and clears your session. You can also remove ZIPORA under GitHub → Settings → Applications.</p>
              <Button variant="danger" loading={signingOut} onClick={() => { setSigningOut(true); void signOut(); }}><LogOut className="h-4 w-4" aria-hidden />Sign out</Button>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Deployment defaults" description="Used when you start a new deployment." />
          <div className="space-y-3 p-4 sm:p-5">
            <Field label="Default commit message" error={msgOk ? null : 'Enter 1–200 characters.'}>
              {(id, d) => <input id={id} aria-describedby={d} value={msg} onChange={(e) => { setMsg(e.target.value); if (e.target.value.trim() && e.target.value.length <= 200) setPrefs({ defaultCommitMessage: e.target.value }); }} className={inputClass} />}
            </Field>
            <Toggle label="Replace existing files by default" description="Overwrite files that differ from the archive." checked={prefs.replaceExisting} onChange={(v) => setPrefs({ replaceExisting: v })} />
            <Toggle label="Delete files missing from the archive by default" description="Off is safest. You always see a warning and can preview before deploying." checked={prefs.deleteMissing} onChange={(v) => setPrefs({ deleteMissing: v })} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Privacy and data" />
          <div className="space-y-3 p-4 sm:p-5">
            <Toggle label="Clear local deployment history when I sign out" description="Useful on shared computers." checked={prefs.clearHistoryOnSignOut} onChange={(v) => setPrefs({ clearHistoryOnSignOut: v })} />
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4"><p className="text-sm text-muted">{plural(records.length, 'deployment record')} stored in this browser.</p><Button size="sm" disabled={records.length === 0} loading={exporting} onClick={() => { setExporting(true); void buildHistoryZip(records, user?.login ?? 'unknown').then((b) => downloadBlob(`zipora-history-${new Date().toISOString().slice(0, 10)}.zip`, b)).finally(() => setExporting(false)); }}><Download className="h-4 w-4" aria-hidden />Export history (ZIP)</Button><Button size="sm" variant="danger" disabled={records.length === 0} onClick={clear}><Trash2 className="h-4 w-4" aria-hidden />Clear history</Button></div>
          </div>
        </Card>
      </div>
    </>
  );
}
