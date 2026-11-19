// Browser tests of the signature moments (golem-signature) on the ui-demo G1 page (apps/stagger, in-process pool).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type W = Window & { studio: any };
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ui-demo/shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function openG1(page: Page, query = ''): Promise<void> {
  await page.goto(`/g1.html${query}`);
  await page.waitForFunction(() => (window as unknown as W).studio && document.querySelector('[data-first-frame]'), null, { timeout: 60_000 });
}

const lineItem = (page: Page, id: string) => page.locator('li.golem-line', { has: page.getByRole('button', { name: `Select line ${id}` }) });
const cssVar = (page: Page, name: string) => page.evaluate((n) => {
  const p = document.querySelector('.golem-line-selected .golem-sentence') as HTMLElement | null;
  return p ? p.style.getPropertyValue(n) : '';
}, name);

/** Runs line `id` until it has a verdict (budget from the page query). */
async function runLine(page: Page, id: string): Promise<string> {
  await page.getByRole('button', { name: `Select line ${id}` }).click();
  await lineItem(page, id).getByRole('button', { name: 'Summon 64 ghosts' }).click();
  await page.waitForFunction((x) => { const s = (window as unknown as W).studio.getState(); return !s.run && s.lines.find((l: any) => l.id === x).verdict; }, id, { timeout: 240_000 });
  return page.evaluate((x) => (window as unknown as W).studio.getState().lines.find((l: any) => l.id === x).status, id);
}

test.describe('the living sentence', () => {
  test('sets the selected response clause large in Gloock', async ({ page }) => {
    await openG1(page);
    await page.getByRole('button', { name: 'Select line 1.2' }).click();
    const r = lineItem(page, '1.2').locator('.golem-response');
    await expect(r).toContainText('stay upright for 3 s');
    const style = await r.evaluate((e) => { const s = getComputedStyle(e); return { family: s.fontFamily, size: parseFloat(s.fontSize) }; });
    expect(style.family).toMatch(/Gloock/);
    expect(style.size).toBeGreaterThanOrEqual(39);
    expect(style.size).toBeLessThanOrEqual(61);
  });

  test('moves the bound words while the hero is shoved and rests after the fuse', async ({ page }) => {
    await openG1(page, '?sleep=600000');
    await page.getByRole('button', { name: 'Select line 1.2' }).click();
    expect(await cssVar(page, '--golem-fuse')).toBe('');
    await page.locator('canvas.golem-canvas').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => Number((document.querySelector('.golem-line-selected .golem-sentence') as HTMLElement).style.getPropertyValue('--golem-force')) > 0, null, { timeout: 2000 });
    // 100 N of the line's 250 N.
    expect(Number(await cssVar(page, '--golem-force'))).toBeCloseTo(0.4, 2);
    await page.waitForTimeout(1000);
    const fuse = Number(await cssVar(page, '--golem-fuse'));
    expect(fuse).toBeGreaterThan(0.1);
    expect(fuse).toBeLessThan(1);
    const tilt = Math.abs(Number(await cssVar(page, '--golem-tilt')));
    expect(tilt).toBeLessThanOrEqual(12);
    await page.screenshot({ path: path.join(SHOTS, 'signature-living-shove.png') });
    await page.waitForFunction(() => !(document.querySelector('.golem-line-selected .golem-sentence') as HTMLElement).dataset['golemLive'], null, { timeout: 60_000 });
    expect(await cssVar(page, '--golem-fuse')).toBe('');
  });

  test('draws the push arrow while a force quantity is dragged, before any test runs', async ({ page }) => {
    await openG1(page);
    const sb = page.getByRole('spinbutton', { name: 'Force in line 1.2' });
    const box = (await sb.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Keep dragging, so the 80 ms commit (which re-runs the line) waits while the arrow is checked and photographed.
    let x = box.x + box.width / 2;
    let dragging = true;
    const drag = (async () => { while (dragging) { x += 4; await page.mouse.move(x, box.y + box.height / 2); await page.waitForTimeout(30); } })();
    await expect(page.locator('.golem-shove-label')).toHaveText(/^2[5-9]\d N$/);
    await page.screenshot({ path: path.join(SHOTS, 'signature-drag-arrow.png') });
    dragging = false;
    await drag;
    await page.mouse.up();
    await page.waitForFunction(() => (window as unknown as W).studio.getState().run, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Stop the run'); (b as HTMLButtonElement | undefined)?.click(); });
    await expect(page.locator('.golem-shove-label')).toBeHidden({ timeout: 30_000 });
  });

  test('fractures a broken line at the word of the signal that broke first, and moves the words in the replay', async ({ page }) => {
    test.setTimeout(900_000);
    const t0 = Date.now();
    await openG1(page, '?trials=8&sleep=600000');
    // 6.2 (100 ms sensor latency) is an Expected_Break line that breaks on its first trials.
    const status = await runLine(page, '6.2');
    console.log(`line 6.2 ${status} after ${Math.round((Date.now() - t0) / 1000)} s`);
    expect(status).toBe('broken');
    const word = lineItem(page, '6.2').locator('.golem-fracture-word');
    await expect(word).toHaveAttribute('data-golem-fracture', /pelvis_z|tilt_deg/, { timeout: 30_000 });
    await expect(word).toHaveText('upright');
    await expect(lineItem(page, '6.2').locator('.golem-fracture-margin')).toHaveText(/^ \u2212\d/);
    await page.screenshot({ path: path.join(SHOTS, 'signature-fracture.png') });
    await page.getByRole('button', { name: /Replay the fall/ }).first().click();
    await page.waitForFunction(() => (window as unknown as W).studio.getState().replay?.active, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(Number(await cssVar(page, '--golem-fuse'))).toBeGreaterThan(0);
  });
});
