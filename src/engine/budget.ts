import { EngineError } from './errors';

/**
 * Caps the bytes held in memory by concurrent uploads. A single item larger than the limit is allowed
 * to run, but only on its own. Waiters are woken on release or abort, so cancellation never hangs.
 */
export class ByteBudget {
  private used = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async acquire(bytes: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new EngineError('CANCELLED', 'Deployment cancelled.');
      if (this.used === 0 || this.used + bytes <= this.limit) {
        this.used += bytes;
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }

  release(bytes: number): void {
    this.used -= bytes;
    const waiting = this.waiters;
    this.waiters = [];
    for (const wake of waiting) wake();
  }
}
