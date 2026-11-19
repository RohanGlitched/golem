// Feature: candy-app, Property 5: Vacuum ratio sanitising
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UD } from '../constants';
import { sanitizeRatio, suctionStep } from '../controller/suction';
import { fakeSuction } from './helpers/fakeSuction';

describe('vacuum ratio', () => {
  it('lands in [0, 1], keeps a valid value, and sends a non-finite value to 0', () => {
    fc.assert(fc.property(fc.double(), (r) => {
      const s = sanitizeRatio(r);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      if (r >= 0 && r <= 1) expect(Object.is(s, r)).toBe(true);
      if (!Number.isFinite(r)) expect(s).toBe(0);
    }), { numRuns: 500 });
  });

  it('records a warning with the original value exactly when the ratio was changed', () => {
    fc.assert(fc.property(fc.double(), (r) => {
      const f = fakeSuction();
      f.data.userdata[UD.switch] = 1;
      f.data.userdata[UD.vacuum] = r;
      f.setTip(0.4, 0, 0.1); f.setCandy(0, 0.4, 0, 0.1 - 0.005);
      suctionStep(f.ctx.mj, f.ctx, f.ids, f.ws);
      const changed = !Object.is(sanitizeRatio(r), r);
      expect(f.data.userdata[UD.warnCount]).toBe(changed ? 1 : 0);
      if (changed) expect(Object.is(f.data.userdata[UD.warnValue], r)).toBe(true);
      // the Trial goes on: a force no larger than the clamped cap
      expect(Math.hypot(...f.forceOn(0))).toBeLessThanOrEqual(3 * sanitizeRatio(r) + 1e-12);
    }), { numRuns: 300 });
  });
});
