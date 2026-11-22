import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => { document.title = title ? `${title} · ZIPORA` : 'ZIPORA — Deploy Anything. Anywhere.'; }, [title]);
}
