import { ChevronDown, ChevronRight, File, FileArchive, FileAudio, FileCode, FileImage, FileJson, FileSpreadsheet, FileText, FileVideo, Folder, FolderOpen, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SourceFile } from '../engine';
import { fileKind, isPreviewable, type FileKind } from '../utils/fileType';
import { formatBytes, plural } from '../utils/format';
import { hasInvisibleChars, safeName } from '../utils/safeName';
import { buildTree, countDirs, matchPaths, type TreeNode } from '../utils/tree';
import { Alert, Badge, cx, inputClass } from './ui';

const ICONS: Record<FileKind, typeof File> = { code: FileCode, data: FileJson, text: FileText, image: FileImage, archive: FileArchive, audio: FileAudio, video: FileVideo, sheet: FileSpreadsheet, other: File };
const PAGE = 200;

interface Row { node: TreeNode; depth: number; more?: undefined }
interface MoreRow { more: number; parent: string; depth: number; node?: undefined }

function FileIcon({ node, open }: { node: TreeNode; open: boolean }) {
  if (node.kind === 'dir') { const I = open ? FolderOpen : Folder; return <I className="h-4 w-4 shrink-0 text-accent-fg" aria-hidden />; }
  const I = ICONS[fileKind(node.name)];
  return <I className="h-4 w-4 shrink-0 text-muted" aria-hidden />;
}

function Preview({ file }: { file: SourceFile }) {
  const [state, setState] = useState<{ text?: string; note?: string }>({});
  useEffect(() => {
    let alive = true;
    setState({});
    if (!isPreviewable(file.path.split('/').pop() ?? file.path)) { setState({ note: 'No preview for this file type.' }); return; }
    if (file.size > 100_000) { setState({ note: 'File is too large to preview.' }); return; }
    file.read().then(
      (b) => {
        if (!alive) return;
        const t = new TextDecoder().decode(b);
        setState(t.includes('\u0000') ? { note: 'Binary content; no preview.' } : { text: t.length > 4000 ? `${t.slice(0, 4000)}\n… (truncated)` : t });
      },
      () => alive && setState({ note: 'Could not read this file.' }),
    );
    return () => { alive = false; };
  }, [file]);
  if (state.note) return <p className="text-sm text-muted">{state.note}</p>;
  if (state.text === undefined) return <p className="text-sm text-muted">Loading preview…</p>;
  // Rendered as a text node inside <pre>: file contents are never interpreted as HTML.
  return <pre aria-label="File preview" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg p-3 font-mono text-xs">{state.text}</pre>;
}

export function FileExplorer({ files, emptyDirs = [] }: { files: readonly SourceFile[]; emptyDirs?: readonly string[] }) {
  const root = useMemo(() => buildTree(files, emptyDirs), [files, emptyDirs]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<TreeNode>();
  const [shown, setShown] = useState<Record<string, number>>({});
  const visible = useMemo(() => matchPaths(root, query), [root, query]);
  const suspicious = useMemo(() => files.filter((f) => hasInvisibleChars(f.path)).length, [files]);

  const rows = useMemo(() => {
    const out: Array<Row | MoreRow> = [];
    const walk = (n: TreeNode, depth: number) => {
      const kids = visible ? n.children.filter((c) => visible.has(c.path)) : n.children;
      const limit = shown[n.path] ?? PAGE;
      for (const c of kids.slice(0, limit)) {
        out.push({ node: c, depth });
        if (c.kind === 'dir' && (visible ? true : open.has(c.path))) walk(c, depth + 1);
      }
      if (kids.length > limit) out.push({ more: kids.length - limit, parent: n.path, depth });
    };
    walk(root, 0);
    return out;
  }, [root, visible, open, shown]);

  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const dirCount = countDirs(root);

  // Arrow keys move between rows; Right/Left expand/collapse folders; Home/End jump.
  const onTreeKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=treeitem]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const cur = items[i];
    const move = (n: number) => { items[Math.max(0, Math.min(items.length - 1, n))]?.focus(); e.preventDefault(); };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if ((e.key === 'ArrowRight' && cur.getAttribute('aria-expanded') === 'false') || (e.key === 'ArrowLeft' && cur.getAttribute('aria-expanded') === 'true')) { cur.click(); e.preventDefault(); }
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and folders" aria-label="Search files and folders" className={cx(inputClass, 'pl-9')} />
          </div>
          <Badge>{plural(files.length, 'file')}</Badge><Badge>{plural(dirCount, 'folder')}</Badge>
        </div>
        {suspicious > 0 && (
          <div className="mb-3"><Alert tone="warn" title={`${plural(suspicious, 'file name')} contain invisible or direction-changing characters`}>These are shown as &lt;U+XXXX&gt; markers. Check that nothing is disguised before deploying.</Alert></div>
        )}
        <ul role="tree" aria-label="Archive contents" onKeyDown={onTreeKey} className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-bg p-1">
          {rows.length === 0 && <li className="p-4 text-sm text-muted">{query ? 'No files match your search.' : 'This archive has no files.'}</li>}
          {rows.map((r, i) =>
            r.node ? (
              <li key={r.node.path} role="none">
                <button
                  type="button" role="treeitem" aria-level={r.depth + 1} aria-selected={selected?.path === r.node.path}
                  aria-expanded={r.node.kind === 'dir' ? (visible ? true : open.has(r.node.path)) : undefined}
                  onClick={() => { setSelected(r.node); if (r.node.kind === 'dir') toggle(r.node.path); }}
                  className={cx('flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left text-sm hover:bg-secondary md:min-h-9', selected?.path === r.node.path && 'bg-secondary')}
                  style={{ paddingLeft: 8 + r.depth * 16 }}
                >
                  {r.node.kind === 'dir' ? (open.has(r.node.path) || visible ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />) : <span className="w-3.5 shrink-0" />}
                  <FileIcon node={r.node} open={open.has(r.node.path) || !!visible} />
                  <span className="min-w-0 flex-1 truncate">{safeName(r.node.name)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{r.node.kind === 'dir' ? (r.node.empty ? 'empty' : plural(r.node.fileCount, 'file')) : formatBytes(r.node.size)}</span>
                </button>
              </li>
            ) : (
              <li key={`more-${i}`} role="none" style={{ paddingLeft: 8 + r.depth * 16 }}>
                <button type="button" className="tap text-sm text-accent-fg hover:underline" onClick={() => setShown((s) => ({ ...s, [r.parent]: (s[r.parent] ?? PAGE) + PAGE }))}>Show {Math.min(r.more, PAGE)} more ({r.more} hidden)</button>
              </li>
            ),
          )}
        </ul>
      </div>

      <aside aria-label="Selected item" className="min-w-0 rounded-lg border border-border bg-secondary/40 p-4">
        {!selected ? <p className="text-sm text-muted">Select a file or folder to see its details.</p> : (
          <div className="space-y-3">
            <div><p className="text-xs uppercase tracking-wide text-muted">{selected.kind === 'dir' ? 'Folder' : fileKind(selected.name)}</p><p className="break-all font-medium">{safeName(selected.name)}</p></div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Path</dt><dd className="break-all font-mono text-xs leading-5">{safeName(selected.path)}</dd>
              <dt className="text-muted">Size</dt><dd>{formatBytes(selected.size)}</dd>
              {selected.kind === 'dir' ? (<><dt className="text-muted">Files</dt><dd>{selected.fileCount.toLocaleString()}</dd></>) : (<><dt className="text-muted">Git SHA</dt><dd className="break-all font-mono text-xs leading-5">{selected.file?.sha ?? '—'}</dd></>)}
            </dl>
            {selected.kind === 'file' && selected.file && <Preview file={selected.file} />}
          </div>
        )}
      </aside>
    </div>
  );
}
