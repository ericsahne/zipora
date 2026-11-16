import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { AuthClient } from './client/auth';
import { Spinner } from './components/ui';
import { AuthProvider } from './contexts/AuthContext';
import { DraftProvider } from './contexts/DraftContext';
import { PreferencesProvider } from './contexts/PreferencesContext';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { RequireAuth } from './layouts/RequireAuth';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Heavy pages (they pull in the ZIP engine) load on demand so the landing page stays small.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const DocsPage = page(() => import('./pages/DocsPage'), 'DocsPage');
const HistoryDetailPage = page(() => import('./pages/HistoryDetailPage'), 'HistoryDetailPage');
const HistoryPage = page(() => import('./pages/HistoryPage'), 'HistoryPage');
const NewDeploymentPage = page(() => import('./pages/NewDeploymentPage'), 'NewDeploymentPage');
const PrivacyPage = page(() => import('./pages/PrivacyPage'), 'PrivacyPage');
const RepositoryPage = page(() => import('./pages/RepositoryPage'), 'RepositoryPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const TermsPage = page(() => import('./pages/TermsPage'), 'TermsPage');
const WorkspacePage = page(() => import('./pages/WorkspacePage'), 'WorkspacePage');

/** Context providers. The router is supplied by the caller (BrowserRouter in main.tsx, MemoryRouter in tests). */
export function Providers({ children, client }: { children: ReactNode; client?: AuthClient }) {
  return (
    <PreferencesProvider>
      <AuthProvider client={client}>
        <DraftProvider>{children}</DraftProvider>
      </AuthProvider>
    </PreferencesProvider>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="grid min-h-[50dvh] place-items-center"><Spinner /></div>}>
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="docs" element={<DocsPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
      </Route>
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="new" element={<NewDeploymentPage />} />
        <Route path="new/repository" element={<RepositoryPage />} />
        <Route path="new/workspace" element={<WorkspacePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:id" element={<HistoryDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  );
}
