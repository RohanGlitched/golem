// Feature: candy-app, Property 6: Switch gating and single target
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UD } from '../constants';
import { suctionStep } from '../controller/suction';
import { fakeSuction } from './helpers/fakeSuction';

const pos = fc.tuple(fc.double({ min: -0.03, max: 0.03, noNaN: true }), fc.double({ min: -0.03, max: 0.03, noNaN: true }), fc.double({ min: -0.03, max: 0.03, noNaN: true }));
const six = fc.array(pos, { minLength: 6, maxLength: 6 });
/** Some candies share a position, so that ties occur. */
const withTies = six.chain((p) => fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 6, maxLength: 6 }).map((src) => p.map((_, i) => (i % 2 === 0 ? p[src[i]!]! : p[i]!))));

describe('suction gating', () => {
  it('applies exactly 0 N to every candy while the switch is off', () => {
    fc.assert(fc.property(six, (cs) => {
      const f = fakeSuction();
      f.setTip(0.4, 0, 0.1);
      cs.forEach((c, i) => f.setCandy(i, 0.4 + c[0], c[1], 0.1 + c[2]));
      suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
      expect(f.data.xfrc_applied.every((v) => Object.is(v, 0))).toBe(true);
    }), { numRuns: 200 });
  });

  it('applies force to at most one candy: the nearest within 0.01 m, the lower index on ties', () => {
    fc.assert(fc.property(withTies, (cs) => {
      const f = fakeSuction();
      f.data.userdata[UD.switch] = 1;
      f.setTip(0.4, 0, 0.1);
      cs.forEach((c, i) => f.setCandy(i, 0.4 + c[0], c[1], 0.1 + c[2]));
      suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
      // oracle
      let best = -1, bestD2 = Infinity;
      cs.forEach((_, i) => {
        const dx = f.data.qpos[7 * i]! - 0.4, dy = f.data.qpos[7 * i + 1]! - 0, dz = f.data.qpos[7 * i + 2]! - 0.1;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      });
      const expected = Math.sqrt(bestD2) <= 0.01 ? best : -1;
      expect(f.data.userdata[UD.target]).toBe(expected);
      const touched = [0, 1, 2, 3, 4, 5].filter((i) => f.forceOn(i).some((v) => v !== 0));
      expect(touched.length).toBeLessThanOrEqual(1);
      if (touched.length === 1) expect(touched[0]).toBe(expected);
    }), { numRuns: 500 });
  });

  it('follows the switch: force only in steps where it is on, exactly 0 from the first step after it turns off', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 2, maxLength: 30 }), (seq) => {
      const f = fakeSuction();
      f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.004);
      for (const on of seq) {
        f.data.xfrc_applied.fill(0);            // the Episode_Runner clears xfrc before substep
        f.data.userdata[UD.switch] = on ? 1 : 0;
        suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
        const mag = Math.hypot(...f.forceOn(0));
        if (on) expect(mag).toBeGreaterThan(0); else expect(mag).toBe(0);
      }
    }), { numRuns: 200 });
  });
});
