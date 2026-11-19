import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noSideDrift, pelvisAbove, stayUpright, trackSpeed } from '../predicates';

const d = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe('Feature: stagger-app, Property 21: stay upright margin', () => {
  it('equals pelvis_z - 0.5 at tilts up to 60 deg and exactly -0.01 above', () => {
    fc.assert(fc.property(d(-1, 2), d(0, 180), (z, tilt) => {
      const m = stayUpright.margin({ pelvis_z: z, tilt_deg: tilt }, {});
      if (tilt > 60) expect(m).toBe(-0.01);
      else expect(Math.abs(m - (z - 0.5))).toBeLessThanOrEqual(1e-12);
    }), { numRuns: 300 });
  });
});

describe('Feature: stagger-app, Property 22: Height, speed and drift margins are exact and monotone', () => {
  it('gives the exact margins after settling', () => {
    fc.assert(fc.property(d(-1, 2), d(0, 2), d(-3, 3), d(-3, 3), d(0, 2), d(2, 100), d(0, 5), d(0, 5),
      (z, len, v, vc, tol, t, drift, len2) => {
        expect(pelvisAbove.margin({ pelvis_z: z }, { length: len })).toBe(z - len);
        expect(trackSpeed.margin({ forward_speed: v, commanded_speed: vc, episode_time: t }, { speed: tol }))
          .toBe(tol - Math.abs(v - vc));
        expect(noSideDrift.margin({ lateral_drift: drift }, { length: len2 })).toBe(len2 - drift);
      }), { numRuns: 200 });
  });
  it('never raises the height margin when the length rises', () => {
    fc.assert(fc.property(d(-1, 2), d(0, 2), d(0, 2), (z, a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(pelvisAbove.margin({ pelvis_z: z }, { length: hi })).toBeLessThanOrEqual(pelvisAbove.margin({ pelvis_z: z }, { length: lo }));
    }), { numRuns: 200 });
  });
  it('never lowers the speed margin when the speed slot rises', () => {
    fc.assert(fc.property(d(-3, 3), d(-3, 3), d(0, 100), d(0, 2), d(0, 2), (v, vc, t, a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const s = { forward_speed: v, commanded_speed: vc, episode_time: t };
      expect(trackSpeed.margin(s, { speed: hi })).toBeGreaterThanOrEqual(trackSpeed.margin(s, { speed: lo }));
    }), { numRuns: 200 });
  });
});

describe('Feature: stagger-app, Property 23: Settling time is forgiven', () => {
  it('returns the speed slot while the episode time is under 2 s', () => {
    fc.assert(fc.property(d(-3, 3), d(-3, 3), d(0, 1.999999), d(1e-6, 2), (v, vc, t, tol) => {
      const m = trackSpeed.margin({ forward_speed: v, commanded_speed: vc, episode_time: t }, { speed: tol });
      expect(m).toBe(tol);
      expect(m).toBeGreaterThan(0);
    }), { numRuns: 200 });
  });
});
