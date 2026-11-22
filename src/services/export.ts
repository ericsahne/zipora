import { formatLogs } from '../engine';
import type { HistoryRecord } from '../types';

/** Saves a Blob through the browser's download mechanism (works in Android Chrome via an <a download> blob URL). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const downloadText = (filename: string, text: string): void => downloadBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

/**
 * A ZIP the user can keep: history.json plus one readable log per deployment. History only lives in this browser,
 * so this is the backup. Contains no tokens or credentials: records never hold any.
 */
export async function buildHistoryZip(records: readonly HistoryRecord[], account: string): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();
  zip.file('README.txt', `ZIPORA deployment history export\nAccount: @${account}\nExported: ${exportedAt}\nRecords: ${records.length}\n\nhistory.json has one entry per deployment (without logs). logs/ has one text log per deployment.\n`);
  zip.file('history.json', JSON.stringify({ exportedAt, account, records: records.map(({ logs: _logs, ...rest }) => rest) }, null, 2));
  const logs = zip.folder('logs')!;
  for (const r of records) logs.file(`${r.createdAt.slice(0, 19).replace(/[:T]/g, '-')}_${safe(r.owner)}_${safe(r.repo)}_${r.id.slice(0, 8)}.txt`, `${r.owner}/${r.repo}@${r.branch}  ${r.status}\n${r.message}\n\n${formatLogs(r.logs)}\n`);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
