// Renders the hero posters (public/poster-<theme>-<wide|narrow>.jpg) from the live G1 studio, so the home page can show the robot
// at first paint and load the physics only on interaction. Usage: node scripts/posters.mjs
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GOLEM_CSP = 'eval';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer(4183);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const theme of ['dark', 'light']) {
  for (const [name, vp] of [['wide', { width: 1440, height: 900 }], ['narrow', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: theme });
    await ctx.addInitScript((t) => { localStorage.setItem('golem:theme', t); }, theme);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:4183/stagger/', { waitUntil: 'load' });
    await page.locator('.golem-stage canvas').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('#studio *')) if (el.children.length === 0 && /^Paused to save power/.test(el.textContent ?? '')) el.style.visibility = 'hidden';
    });
    const box = await page.locator('#studio').boundingBox();
    await page.screenshot({ path: path.resolve(here, `../public/poster-${theme}-${name}.jpg`), type: 'jpeg', quality: 70, clip: { x: 0, y: box.y, width: vp.width, height: Math.min(box.height, name === 'wide' ? 780 : 800) } });
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log('posters written');
