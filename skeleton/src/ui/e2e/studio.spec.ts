// Browser tests of the studio on the ui-demo page (golem-sim Test_App, in-process trial pool).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type W = Window & { studio: any; golemContexts: { count: number } };

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as unknown as W).studio && document.querySelector('[data-first-frame]'), null, { timeout: 30_000 });
}

async function frameIntervals(page: Page, ms: number): Promise<number[]> {
  return page.evaluate((dur) => new Promise<number[]>((resolve) => {
    const out: number[] = [];
    let last = 0;
    const t0 = performance.now();
    const step = (ts: number): void => {
      if (last) out.push(ts - last);
      last = ts;
      if (ts - t0 < dur) requestAnimationFrame(step); else resolve(out);
    };
    requestAnimationFrame(step);
  }), ms);
}

const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN; };

test('@perf draws 64 ghosts with the hero running at 60 fps', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as W).studio.summonSynthetic(64, 8));
  await page.waitForTimeout(500);
  const xs = await frameIntervals(page, 5000);
  const median = pct(xs, 0.5), p95 = pct(xs, 0.95);
  console.log(`Frame_Probe with 64 ghosts: ${xs.length} frames, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
  expect(median).toBeLessThanOrEqual(17);
  expect(p95).toBeLessThanOrEqual(25);
});

test('shows the first meaningful frame within 4 s with the tablet text visible', async ({ page }) => {
  await open(page);
  const t = await page.evaluate(() => performance.getEntriesByName('golem:first-frame')[0]?.startTime ?? Infinity);
  expect(t).toBeLessThan(4000);
  await expect(page.getByRole('complementary', { name: 'Requirements' })).toContainText('WHEN the bob is pushed');
});

test('draws no frame for 1 s once idle after a verdict', async ({ page }) => {
  await open(page, '?sleep=1500&trials=16');
  await page.getByRole('button', { name: 'Select line 1.2' }).click();
  await page.locator('li', { has: page.getByRole('button', { name: 'Select line 1.2' }) }).getByRole('button', { name: 'Summon 64 ghosts' }).click();
  await page.waitForFunction(() => { const s = (window as unknown as W).studio.getState(); return !s.run && s.lines.find((l: any) => l.id === '1.2').verdict; }, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as W).studio.getState().hero === 'sleeping', null, { timeout: 30_000 });
  // Wait for the ghost fade: no render reason left.
  await page.waitForFunction(() => (window as unknown as W).studio.reasons().length === 0, null, { timeout: 30_000 });
  await page.waitForTimeout(100);
  const a = await page.evaluate(() => (window as unknown as W).studio.getState().stageFrames);
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => (window as unknown as W).studio.getState().stageFrames);
  expect(await page.evaluate(() => (window as unknown as W).studio.reasons())).toEqual([]);
  expect(b - a).toBe(0);
});

test('uses one draw call per geom for the ghosts and one WebGL context', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as W).studio.summonSynthetic(64, 4));
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => (window as unknown as W).studio.renderCalls());
  // Test_App: 2 drawn geoms, so the count does not grow with the ghosts. Ghosts 2 + arrows 1, hero 2, floor 1,
  // lamp pool 1, shadow 1 (stage-look), aura decal 1, ticks 1, emet decal 1 (golem-signature) = 11 at most.
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(11);
  expect(await page.evaluate(() => (window as unknown as W).golemContexts.count)).toBe(1);
});

for (const scheme of ['dark', 'light'] as const) {
  test(`fits 375 px without sideways scroll (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const over = await page.evaluate(() => [...document.querySelectorAll('.golem-studio *')]
      .filter((e) => !e.closest('.golem-reel-strip') && !e.closest('.golem-sr-only') && e.getBoundingClientRect().right > 375.5)
      .map((e) => `${e.tagName}.${(e as HTMLElement).className}`).slice(0, 5));
    expect(over).toEqual([]);
    const strip = await page.evaluate(() => { const s = document.querySelector('.golem-reel-strip'); return s ? getComputedStyle(s).overflowX : 'auto'; });
    expect(strip).toBe('auto');
    await ctx.close();
  });

  test(`has no serious or critical accessibility violation (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await open(page);
    const r = await new AxeBuilder({ page }).include('.golem-studio').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    await ctx.close();
  });
}

test('keyboard path: tab order, key push, spinbutton stepping and Escape', async ({ page }) => {
  await open(page);
  // Primary actions come first, then tablet lines, then the reel.
  const order: string[] = [];
  await page.locator('body').focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return e.closest('.golem-actions') ? 'actions' : e.closest('.golem-tablet') ? 'tablet' : e.closest('.golem-reel') ? 'reel' : e.tagName;
    }));
  }
  const firstTablet = order.indexOf('tablet');
  expect(order.slice(0, firstTablet).every((x) => x === 'actions')).toBe(true);
  expect(firstTablet).toBeGreaterThan(0);

  // Arrow key push on the stage: the label shows 100 N, then clears.
  const canvas = page.locator('canvas.golem-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.golem-shove-label')).toHaveText('100 N');
  await expect(page.locator('.golem-shove-label')).toBeHidden({ timeout: 3000 });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(page.locator('.golem-shove-label')).toBeHidden();

  // Spinbutton stepping.
  const sb = page.getByRole('spinbutton', { name: 'Force in line 1.2' });
  await sb.focus();
  await page.keyboard.press('ArrowUp');
  await expect(sb).toHaveAttribute('aria-valuetext', '4 N');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(sb).toHaveAttribute('aria-valuetext', '0 N');
});

test('pointer shove: the label rises while dragging and clears on release', async ({ page }) => {
  await open(page);
  const box = await page.locator('canvas.golem-canvas').boundingBox();
  // The camera follows the walking hero (stage-look), so a pixel found by scanning goes stale within a few frames:
  // scan with the studio's own picking, press at once, and scan again if the press missed.
  let grabbed: { px: number; py: number } | undefined;
  for (let attempt = 0; attempt < 12 && !grabbed; attempt++) {
    const hit = await page.evaluate(({ x, y, w, h }) => {
      const c = document.querySelector('canvas.golem-canvas') as HTMLCanvasElement;
      for (let j = 0.1; j < 0.9; j += 0.02) for (let i = 0.05; i < 0.95; i += 0.01) {
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x + i * w, clientY: y + j * h, pointerId: 77, bubbles: true }));
        const label = document.querySelector('.golem-shove-label') as HTMLElement;
        if (!label.hidden) { c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, bubbles: true })); return { px: x + i * w, py: y + j * h }; }
      }
      return undefined;
    }, { x: box!.x, y: box!.y, w: box!.width, h: box!.height });
    if (!hit) continue;
    await page.mouse.move(hit.px, hit.py);
    await page.mouse.down();
    if (await page.locator('.golem-shove-label').isVisible()) grabbed = hit;
    else await page.mouse.up();
  }
  expect(grabbed).toBeDefined();
  await page.mouse.move(grabbed!.px + 120, grabbed!.py, { steps: 6 });
  await page.waitForTimeout(150);
  const n = Number((await page.locator('.golem-shove-label').textContent())?.replace(' N', ''));
  expect(n).toBeGreaterThan(0);
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await expect(page.locator('.golem-shove-label')).toBeHidden();
});