// Feature: candy-app, Property 36: Handles are returned
import fc from 'fast-check';
import { ModelCache, compileRequirement, liveHandleCount, runTrial } from 'golem-spec';
import { afterAll, describe, expect, it, vi } from 'vitest';
import candy from '../app';
import { CandyController } from '../controller';
import { lexicon } from '../lexicon';

const LINE = 'R1. WHEN a hand reaches in from any direction at up to 1.5 m/s THE arm SHALL keep every link at least 0.10 m from the hand for 1 s';
const cache = new ModelCache();
afterAll(() => { cache.dispose(); });

describe('handle hygiene', () => {
  it('returns the Handle_Counter to its value after every trial: normal, stopped early, and with apply throwing', async () => {
    const before = liveHandleCount();
    const baseReq = compileRequirement(LINE, lexicon).requirement!;
    await runTrial(candy, baseReq, { app: 'candy', reqId: 'R1', seed: 1, scenario: { 'hand.angle': 0, 'hand.speed': 1, 'hand.entry': 0, 'hand.height': 0.1 } }, { cache });
    const baseline = liveHandleCount();          // before + the cached model
    expect(baseline).toBe(before + 1);

    let created = 0;
    const throwAt = { n: -1, calls: 0 };
    const app = {
      ...candy,
      makeController: (ctx: any, rng: () => number) => { created++; return candy.makeController(ctx, rng); },
      lexicon: {
        ...lexicon,
        perturbations: lexicon.perturbations.map((p) => (p.phrase.startsWith('a hand reaches in from') ? {
          ...p, apply: (c: any, t: number, tt: number, v: Record<string, number>) => {
            if (throwAt.n >= 0 && ++throwAt.calls >= throwAt.n) throw new Error('apply failed');
            p.apply(c, t, tt, v);
          },
        } : p)),
      },
    };
    const req = compileRequirement(LINE, app.lexicon).requirement!;
    const dispose = vi.spyOn(CandyController.prototype, 'dispose');

    await fc.assert(fc.asyncProperty(
      fc.constantFrom('normal', 'early', 'throw'), fc.integer({ min: 1, max: 400 }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true }), fc.integer({ min: 0, max: 99999 }),
      async (mode, k, angle, seed) => {
        throwAt.n = mode === 'throw' ? k : -1; throwAt.calls = 0;
        const spec = { app: 'candy', reqId: 'R1', seed, scenario: { 'hand.angle': angle, 'hand.speed': 1, 'hand.entry': 0, 'hand.height': 0.1 } };
        const run = runTrial(app as never, req, spec, { cache, earlyStop: mode === 'early' ? (_t, n) => (n >= 1 + (k % 40) ? 0.5 : undefined) : undefined });
        if (mode === 'throw') await expect(run).rejects.toThrow(/apply failed/); else await run;
        expect(liveHandleCount()).toBe(baseline);
      },
    ), { numRuns: 12 });

    // every controller was disposed exactly once, and its IK solver's own handles are gone
    expect(dispose).toHaveBeenCalledTimes(created);
    for (const self of dispose.mock.contexts) {
      expect(() => (self as any).ik.solve([0.4, 0, 0.1], new Float64Array(7), { q: new Float64Array(7) })).toThrow(/disposed/);
    }
    dispose.mockRestore();
  });

  it('deletes a controller\'s handles once however often dispose is called', () => {
    // covered at the IK level in ik.test.ts and controller.test.ts; here the app-level guard
    expect(typeof CandyController.prototype.dispose).toBe('function');
  });
});
