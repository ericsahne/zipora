import { createApp, type App } from '../../src/server/app';
import { loadConfig, type AuthConfig } from '../../src/server/config';
import { createFakeOAuth, type FakeOAuth, type FakeOAuthOptions } from './fakeOAuth';

export const BASE_ENV: Record<string, string> = {
  GITHUB_CLIENT_ID: 'cid123',
  GITHUB_CLIENT_SECRET: 'csecret-value-456',
  APP_URL: 'https://zipora.test',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnop',
};

/** Minimal browser cookie jar: applies Set-Cookie, honours Max-Age=0 deletion. */
export class Jar {
  readonly cookies = new Map<string, string>();
  raw: string[] = [];
  apply(res: Response): void {
    for (const sc of res.headers.getSetCookie()) {
      this.raw.push(sc);
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (gone) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  /** Sec-Fetch-Site the browser would send (default same-origin). */
  site?: string | null;
  /** Origin header; default = app origin on non-GET, omitted on GET. null forces omission. */
  origin?: string | null;
  csrf?: string;
  jar?: Jar;
}

export async function makeHarness(opts: { env?: Record<string, string>; oauth?: Partial<FakeOAuthOptions> } = {}) {
  const env = { ...BASE_ENV, ...opts.env };
  const config: AuthConfig = loadConfig(env);
  const clock = { t: 1_800_000_000 };
  const oauth: FakeOAuth = createFakeOAuth({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, ...opts.oauth });
  const app: App = await createApp(config, { fetch: oauth.fetch, now: () => clock.t });
  const jar = new Jar();

  async function call(path: string, init: CallInit = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    const j = init.jar ?? jar;
    const headers = new Headers(init.headers);
    if (j.cookies.size) headers.set('cookie', j.header());
    if (init.site !== null) headers.set('sec-fetch-site', init.site ?? 'same-origin');
    const origin = init.origin === undefined ? (method === 'GET' ? null : config.appOrigin) : init.origin;
    if (origin) headers.set('origin', origin);
    if (init.csrf) headers.set('x-csrf-token', init.csrf);
    const res = await app.handle(new Request(new URL(path, config.appOrigin), { method, headers, body: init.body }));
    j.apply(res);
    return res;
  }

  /** Full browser sign-in: /login → GitHub authorizes → /callback (cross-site navigation). */
  async function signIn(returnTo?: string, j: Jar = jar) {
    const login = await call(`/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`, { site: 'none', jar: j });
    const { callback } = oauth.authorize(login.headers.get('location')!);
    const cb = await call(callback.pathname + callback.search, { site: 'cross-site', jar: j });
    return { login, cb, callback };
  }

  async function csrf(j: Jar = jar): Promise<string> {
    const r = await (await call('/api/auth/session', { jar: j })).json() as { csrfToken?: string };
    if (!r.csrfToken) throw new Error('not signed in');
    return r.csrfToken;
  }

  return { env, config, clock, oauth, app, jar, call, signIn, csrf };
}
export type Harness = Awaited<ReturnType<typeof makeHarness>>;
