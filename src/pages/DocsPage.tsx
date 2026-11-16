import { Link } from 'react-router-dom';
import { maxProxiedFileBytes } from '../client/auth';
import { Prose } from '../components/Prose';
import { DEFAULT_LIMITS } from '../engine';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AUTH_ERRORS, ERROR_GUIDE, describeError } from '../services/errors';
import { EngineError } from '../engine';
import { formatBytes } from '../utils/format';

const title = (code: (typeof ERROR_GUIDE)[number]['code']) => describeError(new EngineError(code, '')).title;

export function DocsPage() {
  useDocumentTitle('Documentation');
  const perFile = formatBytes(maxProxiedFileBytes());
  return (
    <Prose
      title="Documentation"
      lead="Everything you need to deploy a ZIP archive to GitHub with ZIPORA, from a phone or a computer."
      toc={[['start', 'Getting started'], ['github', 'Connecting GitHub'], ['zip', 'Uploading ZIP files'], ['repos', 'Selecting repositories'], ['branches', 'Branch selection'], ['deploy', 'Deployment process'], ['limits', 'Supported file sizes'], ['errors', 'Common errors'], ['troubleshooting', 'Troubleshooting'], ['android', 'Using ZIPORA on Android'], ['security', 'Security and privacy']]}
    >
      <section id="start"><h2>Getting started</h2>
        <ol><li>Tap <strong>Sign in with GitHub</strong> and approve the request.</li><li>Open <Link to="/new">New deployment</Link> and choose your ZIP.</li><li>Pick a repository and a branch (or create them), and optionally a target folder.</li><li>Review, optionally <strong>Preview changes</strong>, then <strong>Deploy</strong>.</li></ol>
        <p>The whole flow works in a mobile browser. No computer, terminal or Git installation is needed.</p></section>

      <section id="github"><h2>Connecting GitHub</h2>
        <p>ZIPORA uses GitHub OAuth. By default it asks for the <code>repo</code> permission, which GitHub requires to write to private repositories. An operator can narrow this to <code>public_repo</code> or use a GitHub App.</p>
        <p>Your token is stored in an encrypted, HttpOnly cookie and is added to GitHub requests on the server. Page scripts, including ZIPORA&apos;s own, cannot read it. Sign out in <Link to="/settings">Settings</Link> to revoke it on GitHub, or remove ZIPORA under GitHub → Settings → Applications.</p>
        <p>If sign-in fails you will see a message explaining why (for example, you cancelled, or the sign-in attempt expired). Start again from the landing page.</p></section>

      <section id="zip"><h2>Uploading ZIP files</h2>
        <p>Tap <strong>Browse files</strong> (or drag a file onto the page on a computer) and choose a standard <code>.zip</code>. The archive is opened and verified in your browser; nothing is sent to GitHub until you deploy. You can search the contents, open folders, preview text files and replace or remove the archive.</p>
        <p>ZIPORA refuses archives containing paths that escape the target folder (<code>..</code>), absolute paths, <code>.git</code> folders, symbolic links, duplicate paths, paths that differ only by letter case, or a file that is also a folder. macOS metadata (<code>__MACOSX</code>, <code>.DS_Store</code>) is skipped and reported. Empty folders cannot be stored in Git and are listed as skipped.</p></section>

      <section id="repos"><h2>Selecting repositories</h2>
        <p>You see the repositories you own, collaborate on, or can access through organizations (most recently updated first, up to 500; use search to narrow). Badges show Public/Private, Archived, Fork and missing push access. Archived repositories and repositories you cannot push to are disabled.</p>
        <p><strong>Create repository</strong> makes a new repository (under you or an organization you belong to) with an initial commit so it has a branch to deploy to.</p></section>

      <section id="branches"><h2>Branch selection</h2>
        <p>The default branch is preselected. Choose another, or use <strong>New branch</strong> to create one from any existing branch (it starts at that branch&apos;s current tip). Protected branches are marked: GitHub may refuse a direct push to them, in which case deploy to a new branch and open a pull request.</p>
        <p><strong>Target directory</strong> places the files in a folder inside the repository (empty = root). <strong>Replace existing files</strong> controls whether differing files are overwritten. <strong>Delete files not in the archive</strong> only ever deletes inside the target directory and is off by default.</p></section>

      <section id="deploy"><h2>Deployment process</h2>
        <ol><li>The archive is verified (integrity, paths, limits).</li><li>ZIPORA reads the branch and compares your files with it. <strong>Preview changes</strong> shows this comparison without writing anything.</li><li>Files are uploaded to GitHub as blobs, in parallel, within a memory budget.</li><li>One tree and <strong>one commit</strong> are created. Nothing is visible on the branch yet.</li><li>The branch moves to the new commit with a fast-forward update that never forces.</li></ol>
        <p>Any failure or cancellation before step 5 leaves the branch untouched. If the branch moved while you deployed, ZIPORA re-checks and retries once. You can cancel until the commit starts. Progress, counts, per-stage times and logs are real: they come from the actual GitHub requests. Logs can be copied or downloaded, and every deployment is saved in <Link to="/history">History</Link>.</p></section>

      <section id="limits"><h2>Supported file sizes</h2>
        <ul><li>Archive size: {formatBytes(DEFAULT_LIMITS.maxArchiveBytes)}</li><li>Files per archive: {DEFAULT_LIMITS.maxFiles.toLocaleString()}</li><li>Total extracted size: {formatBytes(DEFAULT_LIMITS.maxTotalBytes)}</li>
          <li>Single file: about {perFile}. Files travel through ZIPORA&apos;s server in serverless requests, which are capped at roughly 4.5&nbsp;MB including encoding overhead. GitHub itself refuses files over 100&nbsp;MB.</li></ul>
        <p>Anything over a limit is rejected before it is sent. ZIP64 and password-protected archives are not supported. A phone with little free memory may struggle near the maximum archive size; split large projects.</p></section>

      <section id="errors"><h2>Common errors</h2>
        <p>Every failure shows a short title, the reason, and a code. What each code means:</p>
        <div role="region" aria-label="Error reference table" tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Error</th><th className="px-3 py-2">Why it happens</th><th className="px-3 py-2">What to do</th></tr></thead>
            <tbody className="divide-y divide-border align-top">
              {ERROR_GUIDE.map((e) => (<tr key={e.code}><td className="px-3 py-2"><span className="font-medium text-fg">{title(e.code)}</span><br /><code>{e.code}</code></td><td className="px-3 py-2">{e.cause}</td><td className="px-3 py-2">{e.fix}</td></tr>))}
            </tbody>
          </table>
        </div>
        <h3 className="mt-6 text-base font-semibold text-fg">Sign-in messages</h3>
        <dl>{Object.entries(AUTH_ERRORS).map(([code, m]) => (<div key={code}><dt>{m.title} <code>{code}</code></dt><dd>{m.message}</dd></div>))}</dl></section>

      <section id="troubleshooting"><h2>Troubleshooting</h2>
        <dl>
          <dt>I was signed out in the middle of a deployment</dt><dd>Sign in again. A commit that already completed is safe on GitHub; one that had not started is simply not created.</dd>
          <dt>The ZIP picker greys out my file</dt><dd>Some Android file managers label ZIPs with an unusual type. Pick the file from the <em>Files</em> app or Downloads, or rename it to end in <code>.zip</code>.</dd>
          <dt>GitHub asks me to sign in but never returns to ZIPORA</dt><dd>You may be in an in-app browser (Telegram, Facebook, etc.) or have the GitHub app intercepting the link. Open ZIPORA directly in Chrome and sign in there.</dd>
          <dt>My organization&apos;s repository does not appear or is refused</dt><dd>An organization owner may need to approve ZIPORA on GitHub (Settings → Third-party access).</dd>
          <dt>Copy logs says it failed</dt><dd>Browsers only allow copying on secure (https) pages. Use <strong>Download</strong> instead.</dd>
          <dt>My history disappeared</dt><dd>History is stored in this browser only. Clearing site data, or using another browser or device, starts empty. Use <strong>Export (ZIP)</strong> in History to keep a copy.</dd>
          <dt>The deployment is slow</dt><dd>Uploads depend on your connection and on GitHub. The elapsed time and per-stage timings on the progress screen show where time is spent.</dd>
        </dl></section>

      <section id="android"><h2>Using ZIPORA on Android</h2>
        <p>ZIPORA is built for phones first: large touch targets, a bottom navigation bar, full-width actions, and a file picker that reads from Files, Downloads and Drive. Use Chrome for the most predictable sign-in. Logs and history exports are saved through the normal Android download flow (check the Downloads folder or the browser&apos;s download notification).</p></section>

      <section id="security"><h2>Security and privacy</h2>
        <ul><li>Your GitHub token never reaches page scripts; it lives in an encrypted, HttpOnly, Secure cookie and is attached server-side.</li><li>State-changing requests are protected against CSRF and cross-site requests.</li><li>The server forwards only the GitHub endpoints needed for deployment.</li><li>ZIPs are checked in your browser; files reach the server only when you deploy, and are not stored.</li><li>History and preferences stay in your browser under your GitHub account id.</li></ul>
        <p>Details: <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>.</p></section>
    </Prose>
  );
}
