import { EngineError } from './errors';

export interface CentralDirectoryEntry { name: string; isDir: boolean }

const fail = (why: string) =>
  new EngineError('CORRUPTED_ZIP', `The archive's file directory is unreadable (${why}).`, { hint: 'Create the ZIP again.' });

/**
 * Lists every entry in the ZIP central directory, duplicates included. JSZip stores entries in a map
 * keyed by name, so a second entry with the same name silently replaces the first; this reader is
 * how duplicates are detected. ZIP64 is rejected (fail closed) rather than guessed at.
 */
export function readCentralDirectory(b: Uint8Array): CentralDirectoryEntry[] {
  if (b.length < 22) throw fail('file too short');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('end-of-directory record not found');
  const total = v.getUint16(eocd + 10, true);
  const size = v.getUint32(eocd + 12, true);
  if (total === 0xffff || size === 0xffffffff) {
    throw new EngineError('INVALID_ZIP', 'ZIP64 archives are not supported.', { hint: 'Create a standard ZIP smaller than 4 GB with fewer than 65,535 files.' });
  }
  // Locate the directory relative to the end record, which stays correct if data precedes the archive.
  let p = eocd - size;
  if (p < 0) throw fail('directory size exceeds file size');
  const decoder = new TextDecoder();
  const entries: CentralDirectoryEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw fail(`entry ${n} header is invalid`);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) throw fail(`entry ${n} overruns the directory`);
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
