import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> { status: 'loading' | 'success' | 'error'; data?: T; error?: unknown }

/** Runs `fn` on mount and whenever `deps` change; aborts the previous run. `reload()` forces a re-run. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ status: 'loading', data: s.data }));
    fnRef.current(ctl.signal).then(
      (data) => { if (!ctl.signal.aborted) setState({ status: 'success', data }); },
      (error: unknown) => { if (!ctl.signal.aborted) setState({ status: 'error', error }); },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
