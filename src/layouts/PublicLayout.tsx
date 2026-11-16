import { Link, Outlet } from 'react-router-dom';
import { Logo } from '../components/Brand';
import { buttonClass } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './AppLayout';

export function PublicLayout() {
  const { status, login } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 md:px-8">
          <Link to="/" aria-label="ZIPORA home" className="tap"><Logo /></Link>
          <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 sm:flex">
            <Link to="/docs" className="tap rounded-lg px-3 text-sm text-muted hover:text-fg">Documentation</Link>
            <a href="/#how-it-works" className="tap rounded-lg px-3 text-sm text-muted hover:text-fg">How it works</a>
          </nav>
          <div className="flex-1" />
          <ThemeToggle />
          {status === 'authenticated'
            ? <Link to="/dashboard" className={buttonClass('primary', 'sm')}>Dashboard</Link>
            : <button type="button" onClick={() => login('/dashboard')} className={buttonClass('secondary', 'sm')}>Sign in</button>}
        </div>
      </header>
      <main id="main" className="min-w-0 flex-1"><Outlet /></main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div><Logo className="[&_span:last-child]:text-sm" /><p className="mt-2">Deploy Anything. Anywhere.</p></div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6">
            <Link to="/docs" className="tap hover:text-fg">Documentation</Link><Link to="/privacy" className="tap hover:text-fg">Privacy</Link><Link to="/terms" className="tap hover:text-fg">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
