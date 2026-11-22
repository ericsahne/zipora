import { Alert } from '../components/ui';
import { Prose } from '../components/Prose';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  return (
    <Prose title="Privacy Policy" lead="What ZIPORA does with your data, in plain language.">
      <Alert tone="info" title="Plain-language summary">This describes how the software behaves. Whoever operates this instance is responsible for adding their identity, contact details and any legal review their jurisdiction requires.</Alert>
      <section><h2>What we receive</h2><p>When you sign in, GitHub shares your public profile (user id, username, display name, avatar) and an access token with the permissions you approved.</p></section>
      <section><h2>Your GitHub token</h2><p>The token is encrypted and kept only in an HttpOnly session cookie in your browser. It is attached to GitHub requests on the server and is never exposed to page scripts. It is not written to a database or to logs. Signing out revokes it on GitHub.</p></section>
      <section><h2>Your files</h2><p>ZIP archives are opened and checked in your browser. Files are sent to the server only when you deploy, so the server can forward them to GitHub on your behalf. The server does not store them.</p></section>
      <section><h2>Data stored in your browser</h2><p>Your theme and defaults, and a history of your deployments (repository, branch, commit message, counts, logs), are stored in this browser&apos;s local storage under your GitHub account id. You can clear them in Settings. This data does not leave your device.</p></section>
      <section><h2>Cookies</h2><p>ZIPORA uses only strictly necessary cookies: an encrypted session cookie and, during sign-in, a short-lived sign-in verification cookie. There is no advertising or analytics tracking.</p></section>
      <section><h2>Third parties</h2><p>Your data is processed by GitHub when you sign in and deploy, under GitHub&apos;s own terms and privacy statement, and by the hosting provider that runs this instance.</p></section>
      <section><h2>Your choices</h2><p>You can revoke ZIPORA at any time under GitHub → Settings → Applications, clear local data in Settings, and sign out.</p></section>
    </Prose>
  );
}
