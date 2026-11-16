import { useState } from 'react';
import type { GitHubClient } from '../engine';
import { useAsync } from '../hooks/useAsync';
import { createBranch, createRepository, listOrgs, validateBranchName, validateRepoName } from '../services/github';
import type { Branch, Repo } from '../types';
import { Button, ErrorAlert, Field, Spinner, inputClass } from './ui';

export function CreateRepoForm({ github, login, onCreated, onCancel }: { github: GitHubClient; login: string; onCreated: (r: Repo) => void; onCancel: () => void }) {
  const orgs = useAsync((signal) => listOrgs(github, signal), [github]);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [touched, setTouched] = useState(false);
  const problem = validateRepoName(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true); setError(undefined);
    try { onCreated(await createRepository(github, { org: owner || undefined, name, description: description.trim(), private: isPrivate })); }
    catch (err) { setError(err); setBusy(false); }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-lg border border-border bg-secondary/40 p-4" aria-label="Create repository">
      <h3 className="font-medium">Create a repository</h3>
      <Field label="Owner" hint={orgs.status === 'loading' ? 'Loading organizations…' : orgs.status === 'error' ? 'Could not load organizations; creating under your account.' : undefined}>
        {(id) => (
          <select id={id} value={owner} onChange={(e) => setOwner(e.target.value)} className={inputClass}>
            <option value="">{login} (you)</option>
            {orgs.data?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </Field>
      <Field label="Repository name" error={touched ? problem : null}>
        {(id, d) => <input id={id} aria-describedby={d} aria-invalid={touched && !!problem} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} spellCheck={false} autoCapitalize="off" />}
      </Field>
      <Field label="Description (optional)">{(id) => <input id={id} value={description} maxLength={350} onChange={(e) => setDescription(e.target.value)} className={inputClass} />}</Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Visibility</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name="visibility" checked={isPrivate} onChange={() => setPrivate(true)} className="accent-[var(--accent)]" />Private</label>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name="visibility" checked={!isPrivate} onChange={() => setPrivate(false)} className="accent-[var(--accent)]" />Public</label>
        </div>
      </fieldset>
      <p className="text-xs text-muted">The repository is created with an initial commit so it has a branch to deploy to.</p>
      {error !== undefined && <ErrorAlert error={error} />}
      <div className="flex gap-2"><Button type="submit" variant="primary" loading={busy}>Create repository</Button><Button onClick={onCancel} disabled={busy}>Cancel</Button></div>
    </form>
  );
}

export function CreateBranchForm({ github, repo, branches, defaultFrom, onCreated, onCancel }: { github: GitHubClient; repo: Repo; branches: Branch[]; defaultFrom: string; onCreated: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [touched, setTouched] = useState(false);
  const problem = validateBranchName(name, branches.map((b) => b.name));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true); setError(undefined);
    try { await createBranch(github, repo.owner, repo.name, name, from); onCreated(name); }
    catch (err) { setError(err); setBusy(false); }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-lg border border-border bg-secondary/40 p-4" aria-label="Create branch">
      <h3 className="font-medium">Create a branch</h3>
      <Field label="New branch name" error={touched ? problem : null}>
        {(id, d) => <input id={id} aria-describedby={d} aria-invalid={touched && !!problem} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} spellCheck={false} autoCapitalize="off" />}
      </Field>
      <Field label="Create from">
        {(id) => <select id={id} value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>{branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</select>}
      </Field>
      {error !== undefined && <ErrorAlert error={error} />}
      <div className="flex gap-2"><Button type="submit" variant="primary" loading={busy}>Create branch</Button><Button onClick={onCancel} disabled={busy}>Cancel</Button></div>
    </form>
  );
}
