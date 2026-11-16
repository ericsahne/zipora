import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePrefs } from '../contexts/PreferencesContext';
import { useHistory } from './useHistory';

/** Signs out (revoking the GitHub token server-side) and, if the user asked for it, wipes local history first. */
export function useSignOut() {
  const { logout } = useAuth();
  const { prefs } = usePrefs();
  const { clear } = useHistory();
  return useCallback(async () => {
    if (prefs.clearHistoryOnSignOut) clear();
    await logout();
  }, [logout, prefs.clearHistoryOnSignOut, clear]);
}
