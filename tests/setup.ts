import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';

// The Phase 1 engine uses crypto.subtle; make sure jsdom environments have Node's implementation.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

if (typeof document !== 'undefined') {
  // jsdom's Blob cannot be a fetch/Request body in Node; the engine builds upload bodies with Blob, so use Node's.
  const { Blob: NodeBlob } = await import('node:buffer');
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true, writable: true });
  await import('@testing-library/jest-dom/vitest');
  const { cleanup, configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 8000 });
  afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
}
