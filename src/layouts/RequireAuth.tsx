import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';

const Center = ({ children }: { children: ReactNode }) => <div className="grid min-h-dvh place-items-center p-6">{children}</div>;

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.status === 'loading') return <Center><div className="flex flex-col items-center gap-4"><LogoMark className="h-10 w-10" /><Spinner label="Checking your session" /></div></Center>;
  if (auth.status === 'error') {
    return <Center><div className="w-full max-w-md"><Alert tone="danger" title="Could not check your session" action={<Button size="sm" onClick={() => void auth.refresh()}>Retry</Button>}>{auth.error}</Alert></div></Center>;
  }
  if (auth.status === 'anonymous') return <Navigate to={`/?returnTo=${encodeURIComponent(loc.pathname)}`} replace />;
  if (auth.status === 'expired') {
    const text = auth.reason === 'token_revoked' ? 'GitHub access for ZIPORA was revoked.' : auth.reason === 'unauthorized' ? 'GitHub or the server rejected your credentials.' : 'Your session ended.';
    return (
      <Center>
        <Card className="w-full max-w-md p-6 text-center">
          <LogoMark className="mx-auto mb-4 h-10 w-10" />
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="mt-2 text-sm text-muted">{text} Sign in again to continue. Anything already deployed is safe on GitHub.</p>
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => auth.login(loc.pathname)}>Sign in with GitHub</Button>
        </Card>
      </Center>
    );
  }
  return <>{children}</>;
}
