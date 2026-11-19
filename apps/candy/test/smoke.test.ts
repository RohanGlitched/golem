// The 3 s smoke Trial and handle hygiene through the real Episode_Runner (Requirements 10.13, 14.6, 14.7, 15.10).
import { ModelCache, compileRequirement, liveHandleCount, runTrial } from 'golem-spec';
import { describe, expect, it, vi } from 'vitest';
import candy from '../app';
import { CandyController } from '../controller';
import { lexicon } from '../lexicon';

const LINE = 'R99. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand for 2 s';
const SPEC = { app: 'candy', reqId: 'R99', seed: 7, scenario: { 'hand.angle': 1.5, 'hand.speed': 0.8, 'hand.entry': 0.2, 'hand.height': 0.15 } };

describe('smoke trial', () => {
  it('compiles the line without diagnostics', () => {
    const r = compileRequirement(LINE, lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.horizon).toBe(2);
  });

  it('runs 3 s of simulated time (1 s warm-up + 2 s) with a finite robustness, no handle left over, in under 2 s wall', async () => {
    const req = compileRequirement(LINE, lexicon).requirement!;
    const cache = new ModelCache();
    const before = liveHandleCount();
    await runTrial(candy, req, SPEC, { cache });                 // compiles the model once
    const dispose = vi.spyOn(CandyController.prototype, 'dispose');
    let samples = -1;
    const t0 = performance.now();
    const res = await runTrial(candy, req, SPEC, { cache, earlyStop: (_t, n) => { samples = n; return undefined; } });
    const ms = performance.now() - t0;
    console.log(`smoke trial: robustness ${res.robustness.toFixed(4)} ${res.unit}, ${samples} samples, ${ms.toFixed(0)} ms wall`);
    expect(Number.isFinite(res.robustness)).toBe(true);
    expect(res.unit).toBe('m');
    expect(samples).toBe(Math.round(req.horizon / candy.controlDt) + 1);
    expect(res.diagnostics.numerical).toBe(false);
    expect(ms).toBeLessThan(2000);
    // the only handle left is the cached model; the controller was disposed once
    expect(liveHandleCount()).toBe(before + 1);
    expect(dispose).toHaveBeenCalledTimes(1);
    cache.dispose();
    expect(liveHandleCount()).toBe(before);
    dispose.mockRestore();
  });

  it('leaves no handle and disposes the controller once when apply throws', async () => {
    const throwing = {
      ...candy,
      lexicon: {
        ...lexicon,
        perturbations: lexicon.perturbations.map((p) => (p.phrase.startsWith('a hand reaches in')
          ? { ...p, apply: () => { throw new Error('apply failed on purpose'); } } : p)),
      },
    };
    const req = compileRequirement(LINE, throwing.lexicon).requirement!;
    const cache = new ModelCache();
    const before = liveHandleCount();
    const dispose = vi.spyOn(CandyController.prototype, 'dispose');
    await expect(runTrial(throwing as never, req, SPEC, { cache })).rejects.toThrow(/apply failed on purpose/);
    expect(liveHandleCount()).toBe(before + 1);
    expect(dispose).toHaveBeenCalledTimes(1);
    for (const ctxThis of dispose.mock.contexts) {
      // the solver's scratch MjData and Jacobian buffers are gone: solving again would throw
      expect(() => (ctxThis as any).ik.solve([0.4, 0, 0.1], new Float64Array(7), { q: new Float64Array(7) })).toThrow(/disposed/);
    }
    cache.dispose();
    expect(liveHandleCount()).toBe(before);
    dispose.mockRestore();
  });
});
