import { createApp, type App } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { json } from './errors.js';
import { toNodeHandler } from './node.js';

let cached: Promise<App> | undefined;

/** Builds the app once per server instance from process.env. A configuration error is not cached. */
export function getApp(env: Record<string, string | undefined> = process.env): Promise<App> {
  if (!cached) {
    cached = Promise.resolve()
      .then(() => createApp(loadConfig(env))) // a bad config surfaces as a rejected promise, never a sync throw
      .catch((e) => { cached = undefined; throw e; });
  }
  return cached;
}

/** Vercel entry point factory: `export default vercelHandler(app => app.login)`. */
export function vercelHandler(pick: (app: App) => (req: Request) => Promise<Response>) {
  return toNodeHandler(async (req) => {
    try {
      return await pick(await getApp())(req);
    } catch (e) {
      if (e instanceof ConfigError) {
        console.error(`[zipora] ${e.message}`); // variable names only, never values
        return json({ error: { code: 'CONFIG_ERROR', message: 'The server is not configured.', problems: e.problems } }, 500);
      }
      throw e;
    }
  });
}

/** One handler for every /api route (used by the Vite dev server; Vercel uses one function per route). */
export function routerHandler(env: Record<string, string | undefined>) {
  return toNodeHandler(async (req) => {
    try {
      return await (await getApp(env)).handle(req);
    } catch (e) {
      if (e instanceof ConfigError) {
        return json({ error: { code: 'CONFIG_ERROR', message: 'The server is not configured.', problems: e.problems } }, 500);
      }
      throw e;
    }
  });
}
