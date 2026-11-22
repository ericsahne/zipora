import { useEffect, useState } from 'react';

/** True on touch-first devices (phones/tablets). False where matchMedia is unavailable. */
export function useCoarsePointer(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : undefined);
  const [coarse, setCoarse] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}
