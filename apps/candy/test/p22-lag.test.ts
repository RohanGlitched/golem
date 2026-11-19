// Feature: candy-app, Property 22: Tracker lag changes only the controller's reading
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../constants';
import { HandDelay } from '../controller/hand-delay';
import { trackerLagsAndHandReaches } from '../perturbations';
import { makeSim } from './helpers/sim';

const values = (lag: number, angle: number) => ({ lag, angle, speed: 0.9, entry: 0.1, height: 0.12 });

/** Runs 2.5 s with the hand perturbation and returns the true hand x, y per control step and what the controller read. */
async function run(lag: number, angle: number) {
  const sim = await makeSim();
  try {
    const v = values(lag, angle);
    trackerLagsAndHandReaches.begin!(sim.ctx, v);
    const m = sim.controller.ids.handMocap;
    const trueXY: number[][] = [];
    const read: number[][] = [];
    sim.run(2.5, {
      perControl: () => {
        trueXY.push([sim.data.mocap_pos[3 * m], sim.data.mocap_pos[3 * m + 1], sim.data.mocap_pos[3 * m + 2]]);
      },
      beforeSim: (t) => { trackerLagsAndHandReaches.apply(sim.ctx, t, 0, v); },
    });
    // controller.handRead after the final step holds the last delayed sample
    const last = Array.from((sim.controller as any).handRead as Float64Array);
    return { trueXY, last, steps: HandDelay.steps(lag) };
  } finally { sim.dispose(); }
}

describe('tracker lag', () => {
  it('leaves the true hand pose identical for any two lags and makes the controller read the pose lag/0.02 steps earlier', async () => {
    await fc.assert(fc.asyncProperty(fc.double({ min: 0, max: 0.3, noNaN: true }), fc.double({ min: 0, max: 0.3, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true }), async (lagA, lagB, angle) => {
      const a = await run(lagA, angle), b = await run(lagB, angle);
      expect(a.trueXY.length).toBe(b.trueXY.length);
      expect(a.trueXY.map((p, i) => p.every((v, k) => Object.is(v, b.trueXY[i]![k])))).not.toContain(false);
      // the last sample the controller read is the true pose `steps` control steps before its newest push
      const n = a.trueXY.length;
      for (const r of [a, b]) {
        const expected = r.trueXY[n - 1 - r.steps]!;
        expect(r.last[0]).toBe(expected[0]); expect(r.last[1]).toBe(expected[1]); expect(r.last[2]).toBe(expected[2]);
      }
    }), { numRuns: 6 });
    expect(SIM_DT).toBe(0.002);
  }, 120000);
});
