import { render } from '@testing-library/react';
import JSZip from 'jszip';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, Providers } from '../../src/App';
import { AuthClient } from '../../src/client/auth';
import { nav } from '../../src/services/navigation';
import { makeHarness, type Harness } from '../server/harness';
import type { FakeOAuthOptions } from '../server/fakeOAuth';

export const repo = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, full_name: `octo-dev/${name}`, owner: { login: 'octo-dev' }, private: false, description: `${name} repository`, default_branch: 'main',
  html_url: `https://github.com/octo-dev/${name}`, permissions: { admin: true, push: true, pull: true }, archived: false, fork: false, pushed_at: '2026-10-01T00:00:00Z', ...extra,
});

export interface Setup { signedIn?: boolean; route?: string; oauth?: Partial<FakeOAuthOptions>; env?: Record<string, string> }

/** Renders the REAL app against the REAL Phase 2 server handlers (in-process) and a fake GitHub. */
export async function setup(opts: Setup = {}) {
  const h: Harness = await makeHarness({
    env: opts.env,
    oauth: {
      gitFiles: { 'README.md': 'hello' },
      repos: [repo(1, 'site'), repo(2, 'notes', { private: true }), repo(3, 'readonly', { permissions: { admin: false, push: false, pull: true } }), repo(4, 'frozen', { archived: true })],
      orgs: ['acme'], ...opts.oauth,
    },
  });
  if (opts.signedIn !== false) await h.signIn();
  const redirect = vi.spyOn(nav, 'redirect').mockImplementation(() => {});
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    return h.call(String(input), { method: init?.method, headers: Object.fromEntries(headers.entries()), body: init?.body ?? undefined, csrf: headers.get('x-csrf-token') ?? undefined });
  };
  const client = new AuthClient({ fetchImpl });
  const ui = render(<MemoryRouter initialEntries={[opts.route ?? '/dashboard']}><Providers client={client}><AppRoutes /></Providers></MemoryRouter>);
  return { h, client, redirect, ...ui };
}

export async function zipFile(files: Record<string, string>, name = 'site.zip'): Promise<File> {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(p, c);
  return new File([new Uint8Array(await z.generateAsync({ type: 'uint8array' }))], name, { type: 'application/zip' });
}

export const SITE = { 'index.html': '<h1>hi</h1>', 'assets/app.js': 'console.log(1)', 'README.md': 'new readme' };
