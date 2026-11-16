import { Link } from 'react-router-dom';
import { buttonClass } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div><p className="text-sm font-medium text-accent-fg">404</p><h1 className="mt-2 text-3xl font-semibold">Page not found</h1><p className="mt-2 text-muted">That address does not exist.</p><Link to="/" className={buttonClass('primary', 'md', 'mt-6')}>Back to ZIPORA</Link></div>
    </div>
  );
}
