import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { HISTORY_EVENT, HistoryStore } from '../services/history';

const storage = (): Storage | undefined => { try { return window.localStorage; } catch { return undefined; } };

/** Deployment history for the signed-in user (this browser only). Re-renders when any part of the app changes it. */
export function useHistory() {
  const { user } = useAuth();
  const userId = user?.id;
  const store = useMemo(() => (userId === undefined ? undefined : new HistoryStore(storage(), userId)), [userId]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(HISTORY_EVENT, bump);
    return () => window.removeEventListener(HISTORY_EVENT, bump);
  }, []);
  const records = useMemo(() => store?.list() ?? [], [store, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useCallback((id: string) => store?.remove(id), [store]);
  const clear = useCallback(() => store?.clear(), [store]);
  return { store, records, remove, clear };
}
