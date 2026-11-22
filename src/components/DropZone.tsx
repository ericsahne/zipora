import { Loader2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { useCoarsePointer } from '../hooks/useCoarsePointer';
import { ZIP_ACCEPT } from '../utils/zipAccept';
import { cx } from './ui';

export function DropZone({ onFile, busy, disabled }: { onFile: (file: File, droppedCount: number) => void; busy?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const touch = useCoarsePointer();
  const pick = (list: FileList | null | undefined) => { const f = list?.[0]; if (f && !disabled && !busy) onFile(f, list.length); };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
      className={cx('rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-10', drag ? 'border-accent bg-accent/10' : 'border-border bg-card')}
    >
      <input ref={input} type="file" accept={ZIP_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose a ZIP file" data-testid="zip-input"
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent-fg">
        {busy ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <UploadCloud className="h-7 w-7" aria-hidden />}
      </span>
      <p className="text-base font-medium">{busy ? 'Reading archive…' : touch ? 'Choose a ZIP file from your phone' : 'Drag and drop a ZIP file here'}</p>
      <p className="mt-1 text-sm text-muted">It is opened and checked in your browser. Nothing is uploaded until you deploy.{touch && ' Pick it from Files, Downloads or Drive.'}</p>
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
        className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-lg bg-accent px-6 text-base font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50 sm:w-auto">
        Browse files
      </button>
    </div>
  );
}
