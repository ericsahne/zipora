import type { Preferences } from '../types';

export const PREFS_KEY = 'zipora:v1:prefs';
export const DEFAULT_PREFS: Preferences = {
  theme: 'dark',
  sidebarCollapsed: false,
  defaultCommitMessage: 'Deploy via ZIPORA',
  replaceExisting: true,
  deleteMissing: false,
  clearHistoryOnSignOut: false,
};

const store = (): Storage | undefined => { try { return window.localStorage; } catch { return undefined; } };

/** Only non-sensitive UI preferences are stored; unknown or malformed values fall back to defaults. */
export function loadPrefs(storage: Storage | undefined = store()): Preferences {
  try {
    const raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    const p = { ...DEFAULT_PREFS };
    if (raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system') p.theme = raw.theme;
    if (typeof raw.sidebarCollapsed === 'boolean') p.sidebarCollapsed = raw.sidebarCollapsed;
    if (typeof raw.defaultCommitMessage === 'string' && raw.defaultCommitMessage.trim() && raw.defaultCommitMessage.length <= 200) p.defaultCommitMessage = raw.defaultCommitMessage;
    if (typeof raw.replaceExisting === 'boolean') p.replaceExisting = raw.replaceExisting;
    if (typeof raw.deleteMissing === 'boolean') p.deleteMissing = raw.deleteMissing;
    if (typeof raw.clearHistoryOnSignOut === 'boolean') p.clearHistoryOnSignOut = raw.clearHistoryOnSignOut;
    return p;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Preferences, storage: Storage | undefined = store()): void {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable: preferences just won't persist */ }
}
