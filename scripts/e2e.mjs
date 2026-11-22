// Runs the Playwright suite. Uses Playwright's own Chromium when installed (`npx playwright install chromium`);
// otherwise falls back to the Chromium shipped inside @sparticuz/chromium (for sandboxes that cannot reach Playwright's CDN).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const env = { ...process.env };
if (!env.PW_CHROMIUM_PATH && !existsSync(chromium.executablePath())) {
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    env.PW_CHROMIUM_PATH = await sparticuz.executablePath();
    // The package targets AWS Lambda: --single-process/--no-zygote make one crashed tab kill the whole browser, so drop them.
    env.PW_CHROMIUM_ARGS = JSON.stringify([...sparticuz.args.filter((a) => !['--single-process', '--no-zygote'].includes(a)), '--no-sandbox']);
    console.log(`[e2e] Playwright's Chromium is not installed; using ${env.PW_CHROMIUM_PATH}`);
  } catch {
    console.error('[e2e] No browser available. Run: npx playwright install chromium');
    process.exit(1);
  }
}
spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 1));
