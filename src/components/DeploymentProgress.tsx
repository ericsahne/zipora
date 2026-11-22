import { CheckCircle2, ChevronRight, Circle, Copy, Download, Loader2, XCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { formatLogs, type DeployEvent, type DeployResult, type Stage } from '../engine';
import { useNow } from '../hooks/useNow';
import { downloadText } from '../services/export';
import { formatDuration } from '../utils/format';
import { Button, cx } from './ui';

export const STAGES: Array<{ key: Stage; label: string }> = [
  { key: 'connecting', label: 'Connecting to GitHub' }, { key: 'preparing', label: 'Preparing repository' }, { key: 'processing', label: 'Uploading files' },
  { key: 'tree', label: 'Creating Git tree' }, { key: 'commit', label: 'Creating commit' }, { key: 'branch', label: 'Updating branch' }, { key: 'complete', label: 'Complete' },
];

/** Expandable logs with copy and download (download works where the clipboard API does not, e.g. plain-http or locked-down mobile browsers). */
export function LogViewer({ logs, name = 'zipora-deployment' }: { logs: DeployEvent[]; name?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail'>();
  const id = useId();
  const copy = async () => {
    try { await navigator.clipboard.writeText(formatLogs(logs)); setCopied('ok'); } catch { setCopied('fail'); }
  };
  return (
    <div className="rounded-lg border border-border bg-bg">
      <div className="flex min-h-12 items-center justify-between gap-2 px-2 sm:px-3">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="tap min-w-0 flex-1 gap-2 rounded-lg px-2 text-left text-sm font-medium">
          <ChevronRight className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />Logs ({logs.length})
        </button>
        <span className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden />{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy logs'}</Button>
          <Button size="sm" variant="ghost" aria-label="Download logs" onClick={() => downloadText(`${name}.log.txt`, formatLogs(logs))}><Download className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Download</span></Button>
        </span>
      </div>
      {open && (
        <pre id={id} aria-label="Deployment logs" className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border p-4 font-mono text-xs leading-5">
          {logs.length === 0 ? 'No log entries.' : logs.map((l, i) => (
            <span key={i} className={cx('block', l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warn' : 'text-muted')}>{`${l.time.slice(11, 19)} ${l.stage.padEnd(10)} ${l.message}`}</span>
          ))}
        </pre>
      )}
    </div>
  );
}

const ms = (iso: string) => new Date(iso).getTime();

/** Driven only by real engine events and their real timestamps: nothing is animated on a timer or assumed. */
export function DeploymentProgress({ events, result }: { events: DeployEvent[]; result?: DeployResult }) {
  const last = events.at(-1);
  const running = !result;
  const now = useNow(running);
  const current = last ? STAGES.findIndex((s) => s.key === last.stage) : -1;
  const failed = result?.status === 'failed' || result?.status === 'cancelled';
  const processed = last?.processed ?? 0;
  const total = last?.total ?? 0;
  const pct = result && !failed ? 100 : total > 0 && current <= 2 ? Math.round((processed / total) * 100) : current > 2 ? 100 : 0;
  const startedAt = events[0] ? ms(events[0].time) : now;
  const endedAt = result && last ? ms(last.time) : now;

  // Per-stage duration = from its first event to the first event of the next stage seen (or the end).
  const firstSeen = new Map<Stage, number>();
  for (const e of events) if (!firstSeen.has(e.stage)) firstSeen.set(e.stage, ms(e.time));
  const durationOf = (i: number): number | undefined => {
    const t0 = firstSeen.get(STAGES[i].key);
    if (t0 === undefined) return undefined;
    for (let j = i + 1; j < STAGES.length; j++) { const t1 = firstSeen.get(STAGES[j].key); if (t1 !== undefined) return t1 - t0; }
    return (i === current && running ? now : endedAt) - t0;
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          <p role="status" aria-live="polite" className="min-w-0 break-words text-muted">{last?.message ?? 'Starting…'}</p>
          <span className="font-semibold tabular-nums">{pct}%</span>
        </div>
        <progress max={100} value={pct} aria-label="Deployment progress" className="h-2.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-value]:bg-accent" />
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Processed', `${processed}/${total}`, ''], ['Succeeded', String(last?.succeeded ?? 0), 'text-success'], ['Failed', String(last?.failed ?? 0), last?.failed ? 'text-danger' : ''], ['Elapsed', formatDuration(Math.max(0, endedAt - startedAt)), '']].map(([k, v, c]) => (
          <div key={k} className="rounded-lg bg-secondary/60 px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className={cx('text-lg font-semibold tabular-nums', c)}>{v}</dd></div>
        ))}
      </dl>

      <ol aria-label="Deployment stages" className="space-y-1">
        {STAGES.map((s, i) => {
          const done = result && !failed ? true : i < current;
          const active = running && i === current;
          const bad = failed && i === current;
          const d = durationOf(i);
          return (
            <li key={s.key} aria-current={active ? 'step' : undefined} className={cx('flex min-h-9 items-center gap-3 text-sm', done || active || bad ? 'text-fg' : 'text-muted')}>
              {bad ? <XCircle className="h-5 w-5 shrink-0 text-danger" aria-hidden /> : done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden /> : active ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-fg" aria-hidden /> : <Circle className="h-5 w-5 shrink-0 text-muted/60" aria-hidden />}
              <span className="flex-1">{s.label}</span>
              {d !== undefined && s.key !== 'complete' && <span className="text-xs tabular-nums text-muted">{formatDuration(Math.max(0, d))}</span>}
            </li>
          );
        })}
      </ol>
      <LogViewer logs={events} />
    </div>
  );
}
