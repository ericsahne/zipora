import { ArrowRight, Eye, FileArchive, GitCommitHorizontal, KeyRound, ShieldCheck, Split, Lock } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { GithubMark } from '../components/Brand';
import { Alert, Button, buttonClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { authErrorFor } from '../services/errors';

const FEATURES = [
  { icon: Eye, title: 'Inspect before you ship', text: 'Browse every folder and file in the archive, search it, and read text files before anything leaves your browser.' },
  { icon: GitCommitHorizontal, title: 'One atomic commit', text: 'Files go up as Git blobs and trees, then a single commit moves your branch. Fail halfway and the branch is untouched.' },
  { icon: ShieldCheck, title: 'Safe by default', text: 'Path traversal, duplicate and colliding paths, symlinks and zip bombs are rejected with clear explanations.' },
  { icon: Split, title: 'Preview the diff', text: 'See which files are new, changed, unchanged or deleted against the live branch before you commit.' },
  { icon: Lock, title: 'Private repos and branches', text: 'Pick any repository you can push to, create a new repository or branch, and deploy into any folder.' },
  { icon: KeyRound, title: 'Your token stays server-side', text: 'The GitHub token lives in an encrypted, HttpOnly cookie. Browser JavaScript never sees it.' },
];
const STEPS = [
  { n: 1, title: 'Sign in with GitHub', text: 'Authorize ZIPORA through GitHub OAuth. You can revoke it at any time.' },
  { n: 2, title: 'Add your ZIP', text: 'Drop an archive. It is verified and unpacked locally so you can review every file.' },
  { n: 3, title: 'Choose a destination', text: 'Select a repository, branch and optional folder, or create new ones.' },
  { n: 4, title: 'Deploy', text: 'Preview the changes, write a commit message, and watch the real deployment run.' },
];

export function LandingPage() {
  useDocumentTitle('');
  const { status, user, login } = useAuth();
  const [params] = useSearchParams();
  const authError = params.get('auth_error');
  const returnTo = params.get('returnTo') ?? '/dashboard';
  const err = authError ? authErrorFor(authError) : null;
  const signedIn = status === 'authenticated';

  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
          {err && <div className="mb-8 max-w-2xl"><Alert tone="danger" title={err.title}>{err.message}</Alert></div>}
          {!err && params.get('returnTo') && status === 'anonymous' && <div className="mb-8 max-w-2xl"><Alert tone="info" title="Sign in to continue">That page needs a GitHub connection.</Alert></div>}
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted"><FileArchive className="h-3.5 w-3.5" aria-hidden />ZIP archive to GitHub commit</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">Deploy Anything.<br /><span className="text-accent-fg">Anywhere.</span></h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">ZIPORA turns a ZIP archive into a reviewed, single commit on the GitHub branch you choose. Inspect the files, preview the changes, then deploy with confidence.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {signedIn ? (
              <Link to="/dashboard" className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>Open dashboard <ArrowRight className="h-5 w-5" aria-hidden /></Link>
            ) : (
              <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={status === 'loading'} onClick={() => login(returnTo)}><GithubMark />Sign in with GitHub</Button>
            )}
            <Link to="/docs" className={buttonClass('secondary', 'lg', 'w-full sm:w-auto')}>Read the docs</Link>
          </div>
          {signedIn && user && <p className="mt-4 text-sm text-muted">Signed in as <span className="font-medium text-fg">@{user.login}</span></p>}
          {!signedIn && <p className="mt-4 max-w-xl text-xs text-muted">On a phone? Use Chrome. If you opened this link inside another app (Telegram, Facebook, etc.) and GitHub does not bring you back here, open ZIPORA in Chrome and sign in there.</p>}
        </div>
      </section>

      <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-16 md:px-8">
        <h2 id="features" className="text-2xl font-semibold tracking-tight">Built for careful deployments</h2>
        <p className="mt-2 max-w-2xl text-muted">Everything a ZIP upload to GitHub should check, and nothing it should hide.</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent-fg"><Icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="font-medium">{title}</h3><p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" aria-labelledby="how" className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="relative">
                <span className="mb-3 grid h-9 w-9 place-items-center rounded-full border border-accent text-sm font-semibold text-accent-fg">{s.n}</span>
                <h3 className="font-medium">{s.title}</h3><p className="mt-1 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center md:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to ship your archive?</h2>
        <div className="mt-6 flex justify-center">
          {signedIn ? <Link to="/new" className={buttonClass('primary', 'lg')}>Start a deployment</Link> : <Button variant="primary" size="lg" disabled={status === 'loading'} onClick={() => login(returnTo)}><GithubMark />Sign in with GitHub</Button>}
        </div>
      </section>
    </>
  );
}
