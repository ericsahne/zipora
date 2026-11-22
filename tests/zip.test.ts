import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { EngineError, inspectZip } from '../src/engine';

const build = async (fill: (z: JSZip) => void, opts: JSZip.JSZipGeneratorOptions = { type: 'uint8array' } as never) => {
  const z = new JSZip();
  fill(z);
  return z.generateAsync({ type: 'uint8array', ...opts } as JSZip.JSZipGeneratorOptions<'uint8array'>);
};
const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof EngineError ? e.code : `other:${e}`; }
  return 'no-error';
};
const patch = (buf: Uint8Array, from: string, to: string) => {
  const a = Buffer.from(from), b = Buffer.from(to);
  const out = Buffer.from(buf);
  for (let i = out.indexOf(a); i !== -1; i = out.indexOf(a, i + 1)) b.copy(out, i);
  return new Uint8Array(out);
};

describe('inspectZip', () => {
  it('extracts nested files and reports empty directories without blocking', async () => {
    const zip = await build((z) => { z.file('src/a.txt', 'A'); z.file('b.txt', 'B'); z.folder('empty'); });
    const r = await inspectZip(zip);
    expect(r.files.map((f) => f.path).sort()).toEqual(['b.txt', 'src/a.txt']);
    expect(r.emptyDirs).toEqual(['empty']);
    expect(r.issues.some((i) => i.code === 'EMPTY_DIR')).toBe(true);
    expect(r.blocking).toBe(false);
    expect(new TextDecoder().decode(await r.files.find((f) => f.path === 'b.txt')!.read())).toBe('B');
  });

  it('rejects empty input and non-zip data', async () => {
    expect(await code(inspectZip(new Uint8Array()))).toBe('INVALID_ZIP');
    expect(await code(inspectZip(new TextEncoder().encode('hello world')))).toBe('INVALID_ZIP');
  });

  it('rejects a truncated archive as corrupted', async () => {
    const zip = await build((z) => z.file('a.txt', 'x'.repeat(2000)));
    expect(await code(inspectZip(zip.slice(0, zip.length >> 1)))).toBe('CORRUPTED_ZIP');
  });

  it('detects flipped data bytes via CRC', async () => {
    const zip = await build((z) => z.file('a.txt', 'hello world hello world'), { compression: 'STORE' } as never);
    const bad = patch(zip, 'hello world hello world', 'hellO world hello world');
    expect(await code(inspectZip(bad))).toBe('CORRUPTED_ZIP');
  });

  it('flags path traversal entries as blocking issues', async () => {
    const zip = await build((z) => { z.file('AA/evil.txt', 'x'); z.file('ok.txt', 'y'); });
    const r = await inspectZip(patch(zip, 'AA/evil.txt', '../evil.txt'));
    expect(r.blocking).toBe(true);
    expect(r.issues.some((i) => i.code === 'INVALID_PATH')).toBe(true);
    expect(r.files.map((f) => f.path)).toEqual(['ok.txt']);
  });

  it('flags case collisions', async () => {
    const r = await inspectZip(await build((z) => { z.file('A.txt', '1'); z.file('a.txt', '2'); }));
    expect(r.blocking).toBe(true);
    expect(r.issues.some((i) => i.code === 'CASE_COLLISION')).toBe(true);
  });

  it('reports skipped macOS metadata instead of dropping it silently', async () => {
    const r = await inspectZip(await build((z) => { z.file('__MACOSX/._a', 'm'); z.file('.DS_Store', 'm'); z.file('a', 'x'); }));
    expect(r.files.map((f) => f.path)).toEqual(['a']);
    expect(r.issues.filter((i) => i.code === 'SKIPPED_JUNK')).toHaveLength(2);
  });

  it('blocks symbolic links', async () => {
    const zip = await build((z) => { z.file('link', 'target', { unixPermissions: 0o120777 }); }, { platform: 'UNIX' } as never);
    const r = await inspectZip(zip);
    expect(r.blocking).toBe(true);
    expect(r.issues[0].code).toBe('SYMLINK');
  });

  it('enforces count, size and archive limits before extraction', async () => {
    const zip = await build((z) => { z.file('a', 'x'.repeat(100)); z.file('b', 'y'); z.file('c', 'z'); });
    expect(await code(inspectZip(zip, { limits: { maxFiles: 2 } }))).toBe('TOO_MANY_FILES');
    expect(await code(inspectZip(zip, { limits: { maxFileBytes: 10 } }))).toBe('FILE_TOO_LARGE');
    expect(await code(inspectZip(zip, { limits: { maxTotalBytes: 50 } }))).toBe('EXTRACTED_TOO_LARGE');
    expect(await code(inspectZip(zip, { limits: { maxArchiveBytes: 10 } }))).toBe('ARCHIVE_TOO_LARGE');
  });

  it('rejects zip bombs by compression ratio', async () => {
    const zip = await build((z) => z.file('zeros.bin', new Uint8Array(20 * 1024 * 1024)), { compression: 'DEFLATE' } as never);
    expect(await code(inspectZip(zip))).toBe('COMPRESSION_RATIO');
  });

  it('honours cancellation', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const zip = await build((z) => z.file('a', 'x'));
    expect(await code(inspectZip(zip, { signal: ctl.signal }))).toBe('CANCELLED');
  });
});
