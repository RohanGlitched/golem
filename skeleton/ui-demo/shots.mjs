// Screenshots of the demo at 1440 and 390 px, dark and light, after one run per line.
// Usage: node ui-demo/shots.mjs   (starts its own Vite server and stops it at the end)
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: path.join(here, 'vite.config.ts'), server: { port: 5199, host: '127.0.0.1' } });
await server.listen();
const base = process.argv[2] ?? 'http://127.0.0.1:5199/';
const out = path.join(here, 'shots');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const scheme of ['dark', 'light']) {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 1000 ? 900 : 844 }, colorScheme: scheme, deviceScaleFactor: width > 1000 ? 1 : 2 });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${base}?autorun=1`);
    await page.waitForFunction(() => window.studio && document.querySelector('[data-first-frame]'), null, { timeout: 30000 });
    // Wait until every runnable line has a verdict.
    await page.waitForFunction(() => {
      const s = window.studio.getState();
      return !s.run && s.lines.filter((l) => l.compiled).every((l) => l.verdict);
    }, null, { timeout: 120000 });
    // Re-run the broken line so its ghosts, aura and reel are on screen together.
    const broken = await page.evaluate(() => window.studio.getState().lines.find((l) => l.status === 'broken')?.id);
    if (broken) {
      await page.locator('li', { has: page.getByRole('button', { name: `Select line ${broken}` }) }).getByRole('button', { name: 'Summon 64 ghosts' }).click();
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.studio.getState().run, null, { timeout: 120000 });
    }
    await page.waitForTimeout(2500);
    const file = path.join(out, `studio-${width}-${scheme}.png`);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: file });
    if (width < 1000) {
      await page.evaluate(() => window.scrollTo(0, document.querySelector('.golem-reel').getBoundingClientRect().top + window.scrollY - 200));
      await page.waitForTimeout(400);
      await page.screenshot({ path: file.replace('.png', '-reel.png') });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const state = await page.evaluate(() => {
      const s = window.studio.getState();
      return { lines: s.lines.map((l) => `${l.id} ${l.status} ${l.summary ?? ''}`), aura: s.aura.summary, messages: s.messages.map((m) => m.text), frames: s.stageFrames,
        scrollW: document.documentElement.scrollWidth };
    });
    console.log(file, JSON.stringify(state, null, 1));
    if (logs.length) console.log(logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
}
await browser.close();
await server.close();
