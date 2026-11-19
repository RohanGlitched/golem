import v8 from 'node:v8';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTrial } from './episode.js';
import { liveHandleCount } from './handles.js';
import { ModelCache } from './model-cache.js';
import { makeTestRequirement, testApp } from './test-app.js';
import type { Trace } from './types.js';
import type { CompiledRequirement, RobotApp, TrialSpec } from './types.js';

const cache = new ModelCache();
let mj: any;
beforeAll(async () => { ({ mj } = await cache.getModel(testApp)); });
afterAll(() => cache.dispose());

/** gc from --expose-gc when present, else exposed at run time through V8 flags. */
function getGc(): () => void {
  const existing = (globalThis as { gc?: () => void }).gc;
  if (existing) return existing;
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

const spec: TrialSpec = { app: 'test', reqId: 'R1', scenario: { 'push.force': 5, 'push.angle': 0 }, seed: 3 };
const noop = { phrase: 'noop', name: 'noop', dims: () => [], apply: () => {} };

/** Counts `new Float64Array` and `new Float32Array` while installed. */
function countTypedArrays(): { count: () => number; restore: () => void } {
  const g = globalThis as any;
  const orig64 = g.Float64Array, orig32 = g.Float32Array;
  let n = 0;
  const wrap = (C: any) => new Proxy(C, { construct(t, args, nt) { n++; return Reflect.construct(t, args, nt); } });
  g.Float64Array = wrap(orig64);
  g.Float32Array = wrap(orig32);
  return { count: () => n, restore: () => { g.Float64Array = orig64; g.Float32Array = orig32; } };
}

function probedApp(onFirst: () => void, onEach: () => void): RobotApp {
  let first = true;
  return {
    ...testApp,
    lexicon: {
      ...testApp.lexicon,
      perturbations: [...testApp.lexicon.perturbations, {
        ...noop,
        apply: () => { if (first) { first = false; onFirst(); } onEach(); },
      }],
    },
  };
}
const reqWith = (horizon: number): CompiledRequirement =>
  makeTestRequirement({ horizon, perturbations: [{ template: 'noop', params: {} }] });

describe('runTrial allocation discipline', () => {
  it('the typed-array probe itself detects allocations', () => {
    const c = countTypedArrays();
    try {
      void new Float64Array(2);
      void new Float32Array(2);
      expect(c.count()).toBe(2);
    } finally { c.restore(); }
  });
  it('creates no handle and no Float64Array/Float32Array inside the Step_Loop', async () => {
    let counter: ReturnType<typeof countTypedArrays> | undefined;
    let startCount = 0, startHandles = 0, calls = 0, endCount = 0, endHandles = 0;
    const app = probedApp(
      () => { counter = countTypedArrays(); startCount = counter.count(); startHandles = liveHandleCount(); },
      () => { calls++; endCount = counter!.count(); endHandles = liveHandleCount(); },
    );
    try { await runTrial(app, reqWith(1), spec, { cache }); } finally { counter?.restore(); }
    expect(calls).toBe(50 * 10);
    expect(endCount - startCount).toBe(0);
    expect(endHandles).toBe(startHandles);
  });
  it('passes the same out object to every signals call', async () => {
    const outs = new Set<unknown>();
    const app: RobotApp = { ...testApp, signals: (ctx, out) => { outs.add(out); testApp.signals(ctx, out); } };
    await runTrial(app, makeTestRequirement({ horizon: 0.5 }), spec, { cache });
    expect(outs.size).toBe(1);
  });
  it('does not call mj_name2id inside the Step_Loop', async () => {
    const orig = mj.mj_name2id;
    let calls = 0;
    let inLoop = false;
    mj.mj_name2id = (...a: unknown[]) => { if (inLoop) calls++; return orig(...a); };
    try {
      const app = probedApp(() => { inLoop = true; }, () => {});
      await runTrial(app, reqWith(0.5), spec, { cache });
    } finally { mj.mj_name2id = orig; }
    expect(calls).toBe(0);
  });
  it('gives the same trace when a controller forces WASM memory growth', async () => {
    const traces: Trace[] = [];
    const base = makeTestRequirement({ horizon: 0.6 });
    const req = { ...base, monitor: (t: Trace) => { traces.push({ t: t.t.slice(), signals: Object.fromEntries(Object.entries(t.signals).map(([k, v]) => [k, v.slice()])), events: t.events }); return base.monitor(t); } };
    await runTrial(testApp, req, spec, { cache });
    let grown = false;
    const growing: RobotApp = {
      ...testApp,
      makeController(ctx, rng) {
        const inner = testApp.makeController(ctx, rng);
        let n = 0;
        return {
          step(c, t) {
            inner.step(c, t);
            if (n++ === 20) {
              const before = c.data.qpos.buffer;
              const b = new mj.DoubleBuffer(8_000_000);
              b.delete();
              grown = c.data.qpos.buffer !== before || before.byteLength === 0;
            }
          },
        };
      },
    };
    await runTrial(growing, req, spec, { cache });
    expect(grown).toBe(true);
    for (const name of Object.keys(traces[0]!.signals)) {
      expect(Array.from(traces[1]!.signals[name]!)).toEqual(Array.from(traces[0]!.signals[name]!));
    }
    expect(Array.from(traces[1]!.t)).toEqual(Array.from(traces[0]!.t));
  });
  it('grows the heap by 64 KiB or less over a 1.5 s horizon', async () => {
    const gc = getGc();
    let start = 0, end = 0;
    const app = probedApp(
      () => { gc(); start = process.memoryUsage().heapUsed; },
      () => {},
    );
    const req = reqWith(1.5);
    const last = app.lexicon.perturbations[1]!;
    const orig = last.apply;
    let n = 0;
    last.apply = (c, t, tt, v) => { orig(c, t, tt, v); if (++n === 150 * 10 - 1) { gc(); end = process.memoryUsage().heapUsed; } };
    await runTrial(app, req, spec, { cache });
    expect(end - start).toBeLessThanOrEqual(64 * 1024);
  });
  it('finishes a 2 s trial on a warm model in under 1 s', async () => {
    const t0 = performance.now();
    await runTrial(testApp, makeTestRequirement({ horizon: 1.8 }), spec, { cache });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

