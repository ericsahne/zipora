import { countDirs, buildTree } from '../utils/tree';
import type { ZipInspection } from '../engine';

/** Reads a File/Blob fully. FileReader works in every browser and in jsdom. */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
    r.readAsArrayBuffer(file);
  });
}

export function summarize(i: ZipInspection) {
  const root = buildTree(i.files, i.emptyDirs);
  return { files: i.files.length, dirs: countDirs(root), bytes: i.totalBytes, errors: i.issues.filter((x) => x.severity === 'error').length, warnings: i.issues.filter((x) => x.severity === 'warning').length };
}
