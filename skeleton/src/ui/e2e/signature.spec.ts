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

test.describe('emet and met', () => {
  test('incises "emet" on the head, crumbles the first e when the selected line breaks, and re-forms it', async ({ page }) => {
    test.setTimeout(600_000);
    await openG1(page, '?trials=8&sleep=600000');
    await page.evaluate(() => localStorage.removeItem('golem:emet-hint'));
    const sig = () => page.evaluate(() => (window as unknown as W).studio.signature.state());
    expect((await sig()).emet).toBe('emet');
    await page.evaluate(() => (window as unknown as W).studio.signature.focusEmet(0.5));
    await page.waitForTimeout(500);
    await page.locator('.golem-stage').screenshot({ path: path.join(SHOTS, 'signature-emet.png') });
    expect(await runLine(page, '6.2')).toBe('broken');
    await page.waitForFunction(() => (window as unknown as W).studio.signature.state().crumble === 1, null, { timeout: 30_000 });
    expect((await sig()).emet).toBe('met');
    await expect(page.locator('.golem-stage-hint')).toHaveText('In the legend, erasing one letter unmakes the golem.');
    await page.evaluate(() => (window as unknown as W).studio.signature.focusEmet(0.5));
    await page.waitForTimeout(500);
    await page.locator('.golem-stage').screenshot({ path: path.join(SHOTS, 'signature-met.png') });
    await page.getByRole('button', { name: 'Select line 6.1' }).click();
    await page.waitForFunction(() => (window as unknown as W).studio.signature.state().crumble === 0, null, { timeout: 30_000 });
    expect((await sig()).emet).toBe('emet');
    // Selecting the broken line again crumbles it again, without a second hint.
    await page.getByRole('button', { name: 'Select line 6.2' }).click();
    await page.waitForFunction(() => (window as unknown as W).studio.signature.state().crumble === 1, null, { timeout: 30_000 });
  });
});

test.describe('bullet time and the scrubber', () => {
  const sig = (page: Page) => page.evaluate(() => (window as unknown as W).studio.signature.state());

  test('slows the swarm to 0.1× for 1.2 s and orbits 40° when the first ghost breaks', async ({ page }) => {
    await openG1(page, '?sleep=600000');
    // Synthetic ghosts: 40 % fall, breaking 0.8 × 2 s = 1.6 s into the generation.
    await page.evaluate(() => (window as unknown as W).studio.summonSynthetic(64, 2));
    await page.waitForFunction(() => { const s = (window as unknown as W).studio.signature.state(); return s.bullet && s.clock.rate < 0.5; }, null, { timeout: 15_000 });
    const a = await sig(page);
    expect(a.clock.rate).toBeCloseTo(0.1, 9);
    const cam0 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(400);
    const b = await sig(page);
    const wall = (await page.evaluate(() => performance.now()) - cam0) / 1000;
    if (b.bullet) expect(b.clock.now - a.clock.now).toBeLessThan(0.15 * wall + 0.03);
    await page.screenshot({ path: path.join(SHOTS, 'signature-bullet-time.png') });
    await page.waitForFunction(() => !(window as unknown as W).studio.signature.state().bullet, null, { timeout: 5000 });
    const c = await sig(page);
    expect(c.clock.rate).toBe(1);
    expect(c.bulletAngle).toBe(40);
  });

  test('skips bullet time under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openG1(page, '?sleep=600000');
    await page.evaluate(() => (window as unknown as W).studio.summonSynthetic(64, 2));
    const seen = await page.evaluate(() => new Promise<boolean>((res) => {
      const t0 = performance.now();
      const step = () => {
        const s = (window as unknown as W).studio.signature.state();
        if (s.bullet) res(true); else if (performance.now() - t0 > 4000) res(false); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
    expect(seen).toBe(false);
  });

  test('scrubs every ghost at once, freezes without a ghosts-running reason, and plays on', async ({ page }) => {
    await openG1(page, '?sleep=600000');
    await page.evaluate(() => (window as unknown as W).studio.summonSynthetic(32, 4));
    const range = page.getByRole('slider', { name: 'Ghost time' });
    await expect(range).toBeVisible({ timeout: 10_000 });
    await range.fill('2.5');
    await page.waitForTimeout(200);
    const a = await sig(page);
    expect(a.clock.frozen).toBe(true);
    expect(a.clock.now - a.playStart).toBeCloseTo(2.5, 6);
    expect(a.reasons).not.toContain('ghosts-running');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    // Orbit the frozen swarm: drag on the floor at the stage's top-left corner.
    const box = (await page.locator('canvas.golem-canvas').boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await sig(page)).clock.now).toBe(a.clock.now);
    await page.screenshot({ path: path.join(SHOTS, 'signature-scrubber-frozen.png') });
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(300);
    const c = await sig(page);
    expect(c.clock.frozen).toBe(false);
    expect(c.clock.now).toBeGreaterThan(a.clock.now);
  });
});

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
