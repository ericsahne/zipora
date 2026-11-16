import { Alert } from '../components/ui';
import { Prose } from '../components/Prose';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function TermsPage() {
  useDocumentTitle('Terms');
  return (
    <Prose title="Terms of Service" lead="The basic terms for using ZIPORA.">
      <Alert tone="info" title="Template terms">These are general terms for a developer tool. Whoever operates this instance should review them with a lawyer and add their legal name, contact details and governing law.</Alert>
      <section><h2>Using the service</h2><p>ZIPORA lets you deploy ZIP archives to GitHub repositories you are authorized to write to. You are responsible for the files you deploy and for having the right to publish them.</p></section>
      <section><h2>Your GitHub account</h2><p>Use of GitHub is governed by GitHub&apos;s terms. You are responsible for activity performed through your signed-in session. Do not use ZIPORA to deploy malware, infringing or unlawful content, or to violate GitHub&apos;s acceptable use policies.</p></section>
      <section><h2>Changes to your repositories</h2><p>A deployment creates a commit on the branch you choose and, if you enable it, can delete files in the target directory. Review the preview before deploying. Commits can be reverted with Git, but ZIPORA cannot guarantee recovery of data you choose to delete.</p></section>
      <section><h2>No warranty</h2><p>The service is provided as is, without warranties of any kind, and may change or be unavailable. To the extent the law allows, the operator is not liable for indirect or consequential loss, or for loss of data.</p></section>
      <section><h2>Ending use</h2><p>You can stop using ZIPORA and revoke its access on GitHub at any time. Access may be suspended for abuse or to protect the service.</p></section>
    </Prose>
  );
}
