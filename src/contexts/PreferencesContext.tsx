import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadPrefs, savePrefs } from '../services/preferences';
import type { Preferences } from '../types';

interface PrefsApi { prefs: Preferences; setPrefs: (patch: Partial<Preferences>) => void; resolvedTheme: 'dark' | 'light' }
const Ctx = createContext<PrefsApi | null>(null);

const systemPrefersLight = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>(() => loadPrefs());
  const [systemLight, setSystemLight] = useState(systemPrefersLight);
  const resolvedTheme = prefs.theme === 'system' ? (systemLight ? 'light' : 'dark') : prefs.theme;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => setSystemLight(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme; }, [resolvedTheme]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setState((prev) => { const next = { ...prev, ...patch }; savePrefs(next); return next; });
  }, []);
  const value = useMemo(() => ({ prefs, setPrefs, resolvedTheme }), [prefs, setPrefs, resolvedTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PreferencesProvider>');
  return v;
}
