import type { SourceFile } from '../engine';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size: number;
  fileCount: number;
  empty?: boolean;
  children: TreeNode[];
  file?: SourceFile;
}

const byName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export function buildTree(files: readonly SourceFile[], emptyDirs: readonly string[] = []): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'dir', size: 0, fileCount: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const ensureDir = (path: string): TreeNode => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf('/');
    const parent = ensureDir(i < 0 ? '' : path.slice(0, i));
    const node: TreeNode = { name: path.slice(i + 1), path, kind: 'dir', size: 0, fileCount: 0, children: [] };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const d of emptyDirs) ensureDir(d).empty = true;
  for (const f of files) {
    const i = f.path.lastIndexOf('/');
    ensureDir(i < 0 ? '' : f.path.slice(0, i)).children.push({ name: f.path.slice(i + 1), path: f.path, kind: 'file', size: f.size, fileCount: 1, children: [], file: f });
  }
  const finish = (n: TreeNode): void => {
    n.children.sort(byName);
    for (const c of n.children) {
      if (c.kind === 'dir') finish(c);
      n.size += c.size;
      n.fileCount += c.fileCount;
    }
  };
  finish(root);
  return root;
}

export function countDirs(n: TreeNode): number {
  return n.children.reduce((acc, c) => acc + (c.kind === 'dir' ? 1 + countDirs(c) : 0), 0);
}

/** Paths to show for a search: every match plus its ancestors. null = no filter. */
export function matchPaths(root: TreeNode, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const visit = (n: TreeNode, ancestors: string[]): void => {
    const hit = n.path !== '' && (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
    if (hit) { keep.add(n.path); for (const a of ancestors) keep.add(a); }
    for (const c of n.children) visit(c, n.path ? [...ancestors, n.path] : ancestors);
  };
  visit(root, []);
  return keep;
}
