// Lighthouse (performance, accessibility, best practices, SEO) on / , /kit/ and /evidence/ against site/dist, mobile and desktop.
// Usage: node scripts/lighthouse.mjs   (writes .lighthouse/summary.json)
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from './serve.mjs';

const PORT = 4181;
const server = await startServer(PORT);
const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
const out = [];
for (const url of ['/', '/kit/', '/evidence/']) {
  for (const form of ['mobile', 'desktop']) {
    const config = form === 'desktop' ? { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 } } } : undefined;
    const r = await lighthouse(`http://127.0.0.1:${PORT}${url}`, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] }, config);
    const c = r.lhr.categories;
    const row = { url, form, performance: Math.round(c.performance.score * 100), accessibility: Math.round(c.accessibility.score * 100), bestPractices: Math.round(c['best-practices'].score * 100), seo: Math.round(c.seo.score * 100), lcpMs: Math.round(r.lhr.audits['largest-contentful-paint'].numericValue), tbtMs: Math.round(r.lhr.audits['total-blocking-time'].numericValue), cls: Number(r.lhr.audits['cumulative-layout-shift'].numericValue.toFixed(3)) };
    console.log(JSON.stringify(row));
    out.push(row);
  }
}
mkdirSync('.lighthouse', { recursive: true });
writeFileSync('.lighthouse/summary.json', JSON.stringify(out, null, 2));
await chrome.kill();
server.close();
