// Renders public/og.png (1200x630): the measured G1 stability map in clay on the dark ground, with the site's one line.
// Usage: node scripts/og.mjs   (needs Playwright's chromium)
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const summary = JSON.parse(readFileSync(path.resolve(site, '../evidence/results/g1-map.summary.json'), 'utf8'));
const font = (f) => pathToFileURL(path.join(site, 'public/fonts', f)).href;

const cx = 900, cy = 315, R = 270, maxN = 300, half = 5;
const pt = (deg, n) => { const r = (Math.min(n, maxN) / maxN) * R; const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const wedge = (deg, n) => {
  const r = (Math.min(n, maxN) / maxN) * R;
  const [ax, ay] = pt(deg - half, n); const [bx, by] = pt(deg + half, n);
  return `M${cx} ${cy}L${ax.toFixed(1)} ${ay.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}Z`;
};
const w = summary.meta.weakest;
const wedges = summary.summary.map((d) => `<path d="${wedge(d.dirDeg, d.minHeldN)}" fill="${d.dirDeg === w.dirDeg ? '#D0452F' : '#C9B59C'}" fill-opacity="${d.dirDeg === w.dirDeg ? 0.9 : 0.55}" stroke="${d.dirDeg === w.dirDeg ? '#D0452F' : '#C9B59C'}"/>`).join('');
const rings = [100, 200, 300].map((n) => `<circle cx="${cx}" cy="${cy}" r="${(n / maxN) * R}" fill="none" stroke="#C9B59C" stroke-opacity=".3"/>`).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Gloock;src:url(${font('Gloock-Regular.ttf')})}
@font-face{font-family:B612;src:url(${font('B612-Regular.ttf')})}
@font-face{font-family:'B612 Mono';src:url(${font('B612Mono-Regular.ttf')})}
html,body{margin:0;background:#2A211C}
.c{position:relative;width:1200px;height:630px;overflow:hidden;color:#EDE6DC;font-family:B612}
h1{position:absolute;left:64px;top:70px;margin:0;font:400 92px/1 Gloock;letter-spacing:0}
p{position:absolute;left:64px;margin:0}
.a{top:200px;font-size:30px;line-height:1.3;width:480px}
.b{top:430px;font:400 22px/1.4 'B612 Mono';color:#B8AC9E;width:460px}
.b b{color:#D0452F;font-weight:400}
svg{position:absolute;left:0;top:0}
</style><div class="c"><svg width="1200" height="630">${rings}${wedges}</svg>
<h1>GOLEM</h1><p class="a">EARS requirements from a Kiro spec, run as physics tests.</p>
<p class="b">Weakest push: <b>${w.minHeldN} N at ${w.dirDeg}&deg;</b><br>Strongest: ${summary.meta.strongest.minHeldN.toFixed(1)} N at ${summary.meta.strongest.dirDeg}&deg;</p></div>`;

import { mkdirSync, rmSync } from 'node:fs';
mkdirSync(path.join(site, 'shots'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const tmp = path.join(site, 'shots/og-tmp.html');
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(site, 'public/og.png') });
await browser.close();
rmSync(tmp);
console.log('wrote public/og.png');
