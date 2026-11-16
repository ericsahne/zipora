import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev only: serves the real /api/* routes (the same code Vercel runs) from the Vite dev server, so
 * sign-in and the GitHub proxy work locally without the Vercel CLI. Reads APP_URL, GITHUB_CLIENT_ID,
 * GITHUB_CLIENT_SECRET, SESSION_SECRET from .env (never exposed to the browser: no VITE_ prefix).
 */
function apiDev(): Plugin {
  return {
    name: 'zipora-api-dev',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const { routerHandler } = (await server.ssrLoadModule('/src/server/runtime.ts')) as typeof import('./src/server/runtime');
          await routerHandler(env)(req, res);
        } catch (e) {
          server.config.logger.error(String(e));
          res.statusCode = 500;
          res.end('{"error":{"code":"INTERNAL","message":"Dev API failed"}}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDev()],
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
  },
});
