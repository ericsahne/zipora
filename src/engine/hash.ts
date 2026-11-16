/** Git blob object id, so unchanged files can be detected without uploading them. */
export async function gitBlobSha(data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${data.byteLength}\0`);
  const buf = new Uint8Array(header.length + data.byteLength);
  buf.set(header);
  buf.set(data, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const B64 = new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');

/** Base64 as ASCII bytes, written straight into one buffer: no per-chunk strings, no spread arguments. */
export function encodeBase64Bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.ceil(data.length / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < data.length; i += 3) {
    const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out[o++] = B64[n >> 18];
    out[o++] = B64[(n >> 12) & 63];
    out[o++] = B64[(n >> 6) & 63];
    out[o++] = B64[n & 63];
  }
  const rem = data.length - i;
  if (rem === 1) {
    const n = data[i] << 16;
    out[o++] = B64[n >> 18]; out[o++] = B64[(n >> 12) & 63]; out[o++] = 61; out[o++] = 61;
  } else if (rem === 2) {
    const n = (data[i] << 16) | (data[i + 1] << 8);
    out[o++] = B64[n >> 18]; out[o++] = B64[(n >> 12) & 63]; out[o++] = B64[(n >> 6) & 63]; out[o++] = 61;
  }
  return out;
}

export function toBase64(data: Uint8Array): string {
  return new TextDecoder().decode(encodeBase64Bytes(data));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
