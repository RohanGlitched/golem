// Smoke test of the built site at 1440 and 390 px in both themes. Screenshots go to site/shots/ (git-ignored).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const PAGES = ['/', '/kit/', '/evidence/', '/how-kiro/', '/stagger/', '/candy/', '/no-such-page'];
const SIZES = [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }];
const THEMES = ['dark', 'light'] as const;
const PORT = 4179;
let server: { close(): void };

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  // MuJoCo's embind needs 'unsafe-eval'; infra/stack.yaml does not allow it yet (reported as open), so the studio tests serve with it.
  process.env['GOLEM_CSP'] ??= 'eval';
  const mod = await import('../scripts/serve.mjs' as string);
  server = await mod.startServer(PORT);
});
test.afterAll(() => { server.close(); });

const slug = (p: string): string => (p === '/' ? 'home' : p.replace(/\//g, ''));

async function open(page: Page, url: string, theme: 'dark' | 'light'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of 4/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('golem:theme', t); } catch { /* private mode */ } }, theme);
  await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  return errors;
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    for (const url of PAGES) {
      test(`${url} at ${size.name} px, ${theme}: no sideways scroll, one h1, footer, no errors`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = await open(page, url, theme);
        if (url === '/') await page.locator('[data-wake]').click();
        if (url === '/' || url === '/stagger/' || url === '/candy/') await page.waitForTimeout(2500);
        if (url === '/') await page.locator('.golem-studio').waitFor({ timeout: 60_000 });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(w.sw, 'scrollWidth').toBeLessThanOrEqual(w.cw);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('footer.site-foot')).toHaveCount(1);
        expect(await page.locator('footer a[href="https://github.com/RohanGlitched/golem"]').count()).toBeGreaterThan(0);
        expect(errors, errors.join('\n')).toEqual([]);
        if (url === '/' || url === '/stagger/' || url === '/candy/') {
          await expect(page.locator('.hero-fallback')).toHaveCount(0);
          await expect(page.locator('body')).not.toContainText('Could not load MuJoCo');
          await expect(page.locator('.golem-studio')).toHaveCount(1);
        }
        await page.screenshot({ path: path.join(shots, `${slug(url)}-${size.name}-${theme}.png`), fullPage: false });
        await ctx.close();
      });
    }
  }
}

test('the theme toggle switches and remembers the theme', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/kit/`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await ctx.close();
});

test('hovering a wedge of the polar map reads the direction, the held force and the weakest phase', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/evidence/`);
  await page.locator('.wedge[data-dir="80"]').dispatchEvent('pointerover');
  const text = await page.locator('#polar-read').innerText();
  expect(text).toMatch(/80\u00b0/);
  expect(text).toMatch(/holds 62\.5 N/);
  expect(text).toMatch(/weakest stride phase 0\.2/);
  await ctx.close();
});

test('the studio loads on the home page and not on the kit page', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const loaded: string[] = [];
  page.on('request', (r) => { if (/mujoco|\.wasm|policy\.bin/.test(r.url())) loaded.push(r.url()); });
  await page.goto(`http://127.0.0.1:${PORT}/kit/`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  expect(loaded).toEqual([]);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await expect(page.locator('.poster')).toBeVisible();
  expect(loaded).toEqual([]);
  await page.locator('[data-wake]').click();
  await page.locator('#studio .golem-studio').waitFor({ timeout: 30_000 });
  await ctx.close();
});
