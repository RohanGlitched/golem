// Smoke_Trial (Requirement 18.4 to 18.7) and the model compile check (3.10, 3.11).
import { ModelCache, compileRequirement, liveHandleCount, runTrial } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import stagger from '../app';
import { lexicon } from '../lexicon';
import { getMj } from './helpers/mujoco';


const LINE = 'R99. WHEN the pelvis is pushed with 0 N for 0.2 s from 0 deg at any point in its stride THE robot SHALL stay upright for 1.8 s';

describe('smoke trial', () => {
  it('compiles the scene to 12 actuators and nq 19 within 5 s', async () => {
    const mj = await getMj();
    for (const [p, b] of Object.entries(await stagger.files())) {
      mj.FS.mkdirTree(p.includes('/') ? `/robot/${p.slice(0, p.lastIndexOf('/'))}` : '/robot');
      mj.FS.writeFile(`/robot/${p}`, b);
    }
    const t0 = performance.now();
    const model = mj.MjModel.from_xml_path('/robot/scene.xml');
    const ms = performance.now() - t0;
    try {
      console.log(`scene compile: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(5000);
      expect(model.nu).toBe(12);
      expect(model.nq).toBe(19);
    } finally { model.delete(); }
  });

  it('runs 2 s after warm-up with a 0 N push and returns a finite robustness and a full trace', async () => {
    const r = compileRequirement(LINE, lexicon);
    expect(r.diagnostics).toEqual([]);
    const req = r.requirement!;
    expect(req.horizon).toBeCloseTo(2, 12);
    const fresh = new ModelCache();
    const before = liveHandleCount();
    let traceLen = -1;
    const t0 = performance.now();
    const res = await runTrial(stagger, req, {
      app: 'stagger', reqId: 'R99', seed: 7, scenario: { 'push.force': 0, 'push.angle': 0, 'push.phase': 0.3 },
    }, { cache: fresh, earlyStop: (trace, n) => { traceLen = n; void trace; return undefined; } });
    const ms = performance.now() - t0;
    console.log(`smoke trial: robustness ${res.robustness.toFixed(4)} ${res.unit}, ${traceLen} samples, ${ms.toFixed(0)} ms wall`);
    expect(Number.isFinite(res.robustness)).toBe(true);
    expect(res.robustness).toBeGreaterThan(0);
    expect(traceLen).toBe(Math.round(req.horizon / stagger.controlDt) + 1);
    // the only handle left is the cached model
    expect(liveHandleCount()).toBe(before + 1);
    fresh.dispose();
    expect(liveHandleCount()).toBe(before);
    expect(ms).toBeLessThan(15000);
  });
});
