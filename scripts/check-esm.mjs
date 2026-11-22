// Loads the compiled Vercel entry points under plain Node ESM (no bundler, no Vite) to prove every import resolves.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const files = [
  ...readdirSync('.esm-check/api/auth').map((f) => join('.esm-check/api/auth', f)),
  ...readdirSync('.esm-check/api/github').map((f) => join('.esm-check/api/github', f)),
].filter((f) => f.endsWith('.js'));
for (const f of files) {
  const mod = await import(pathToFileURL(join(process.cwd(), f)).href);
  if (typeof mod.default !== 'function') throw new Error(`${f}: default export is not a function`);
  console.log('ok', f);
}
