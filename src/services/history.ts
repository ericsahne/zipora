import type { DeployEvent, DeployResult } from '../engine';
import type { HistoryRecord } from '../types';

export const MAX_RECORDS = 100;
export const MAX_LOG_EVENTS = 400;
export const HISTORY_EVENT = 'zipora:history';
const STATUSES = new Set(['success', 'no-changes', 'failed', 'cancelled']);

const isRecord = (x: unknown): x is HistoryRecord => {
  const r = x as Partial<HistoryRecord> | null;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.createdAt === 'string' && typeof r.status === 'string' && STATUSES.has(r.status)
    && typeof r.owner === 'string' && typeof r.repo === 'string' && typeof r.branch === 'string' && Array.isArray(r.logs) && !!r.counts;
};

/**
 * Deployment history lives in THIS browser only (localStorage), under a key that includes the GitHub user id,
 * so another account signing in on the same browser never sees it. There is no server-side history yet.
 */
export class HistoryStore {
  constructor(private readonly storage: Storage | undefined, private readonly userId: number) {}
  private get key(): string { return `zipora:v1:history:${this.userId}`; }

  list(): HistoryRecord[] {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(this.key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      return [];
    }
  }
  private write(list: HistoryRecord[]): boolean {
    try {
      this.storage?.setItem(this.key, JSON.stringify(list));
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_EVENT));
      return true;
    } catch {
      return false;
    }
  }
  get(id: string): HistoryRecord | undefined { return this.list().find((r) => r.id === id); }
  add(record: HistoryRecord): boolean { return this.write([record, ...this.list()].slice(0, MAX_RECORDS)); }
  remove(id: string): boolean { return this.write(this.list().filter((r) => r.id !== id)); }
  clear(): void {
    try { this.storage?.removeItem(this.key); if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_EVENT)); } catch { /* ignore */ }
  }
}

export function toRecord(result: DeployResult, ctx: Omit<HistoryRecord, 'id' | 'status' | 'counts' | 'commitSha' | 'commitUrl' | 'error' | 'logs'>): HistoryRecord {
  const logs: DeployEvent[] = result.logs.slice(-MAX_LOG_EVENTS);
  return {
    ...ctx,
    id: globalThis.crypto.randomUUID(),
    status: result.status,
    counts: result.counts,
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    error: result.error ? { code: result.error.code, message: result.error.message, hint: result.error.hint } : undefined,
    logs,
  };
}
