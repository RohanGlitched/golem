// Feature: candy-app, Property 7: Suction adds without disturbing other forces
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UD } from '../constants';
import { suctionForce, suctionStep } from '../controller/suction';
import { NBODY, fakeSuction } from './helpers/fakeSuction';

describe('suction is additive', () => {
  it('leaves every other row unchanged and adds exactly the suction force to the target', () => {
    const rows = fc.array(fc.double({ min: -50, max: 50, noNaN: true }), { minLength: 6 * NBODY, maxLength: 6 * NBODY });
    const small = fc.double({ min: -0.012, max: 0.012, noNaN: true }).map((x) => (Math.abs(x) < 1e-6 ? 0 : x));
    fc.assert(fc.property(rows, small, small, small, fc.double({ min: -1, max: 1, noNaN: true }).map((x) => (Math.abs(x) < 1e-6 ? 0 : x)), (init, dx, dy, dz, vz) => {
      const f = fakeSuction();
      f.data.userdata[UD.switch] = 1;
      f.setTip(0.4, 0, 0.1);
      f.setCandy(0, 0.4 + dx, dy, 0.1 + dz);
      for (let i = 1; i < 6; i++) f.setCandy(i, 0.9, 0.9, 0);
      f.data.qvel[2] = vz;
      f.data.xfrc_applied.set(init);
      suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
      const target = f.data.userdata[UD.target]!;
      const row = (i: number) => 6 * (2 + i);
      const expected = new Float64Array(3);
      if (target === 0) suctionForce(expected, [0.4, 0, 0.1], [0, 0, 0], [0.4 + dx, dy, 0.1 + dz], [0, 0, vz], 3);
      for (let r = 0; r < NBODY; r++) for (let k = 0; k < 6; k++) {
        const idx = 6 * r + k;
        const after = f.data.xfrc_applied[idx]!;
        if (target === 0 && idx >= row(0) && idx < row(0) + 3) expect(after).toBe(init[idx]! + expected[idx - row(0)]!);
        else expect(Object.is(after, init[idx]!)).toBe(true);
      }
    }), { numRuns: 300 });
  });
});
