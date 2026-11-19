// Demo page: mounts the studio on the inline Test_App with the in-process trial pool.
// Query parameters: ?autorun=1 runs every line on load; ?fake=1 replaces the falsifier by a fixed fake (e2e).
import { mountStudio } from '../src/ui/index.js';
import { InlinePool } from '../src/ui/run/inline-pool.js';
import { demoApp } from './demo-app.js';
import md from './requirements.md?raw';

const params = new URLSearchParams(location.search);
const el = document.getElementById('app') as HTMLElement;
const pool = new InlinePool(demoApp);

// Wrap getContext once so tests can count WebGL contexts.
const contexts: { count: number } = { count: 0 };
const orig = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
  const ctx = (orig as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
  if (ctx && (type === 'webgl2' || type === 'webgl') && !(this as { __golemCounted?: boolean }).__golemCounted) {
    (this as { __golemCounted?: boolean }).__golemCounted = true;
    if (this.isConnected) contexts.count++;
  }
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;

const studio = mountStudio(el, demoApp, md, {
  pool,
  seed: Number(params.get('seed') ?? 1),
  budget: { maxTrials: Number(params.get('trials') ?? 128), maxMs: 20000 },
  autorun: params.get('autorun') === '1',
  idleSleepMs: Number(params.get('sleep') ?? 10000),
  fontBaseUrl: './fonts/',
  testHooks: { summonSynthetic: true },
});

Object.assign(window, { studio, golemContexts: contexts });
