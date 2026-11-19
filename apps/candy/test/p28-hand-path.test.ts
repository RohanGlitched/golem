// Feature: candy-app, Property 28: Hand path (the doorstep rule, proposal P8)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOWLS, DOORSTEP, HAND, HAND_ENTRY_FALLBACK, HAND_HEIGHT_RANGE, HAND_START, TABLE, WORKSPACE } from '../constants';
import { doorstepAzimuth, doorstepEntryPoint, handPose, inWorkspace, nearestBowl } from '../geometry';

// times on a microsecond grid: a denormal entry time would vanish when added to the trigger time
const micro = (x: number): number => Math.round(x * 1e6) / 1e6;
const values = fc.record({
  angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true }),
  speed: fc.double({ min: 0, max: 1.5, noNaN: true }),
  entry: fc.double({ min: 0, max: HAND_ENTRY_FALLBACK, noNaN: true }).map(micro),
  height: fc.double({ min: HAND_HEIGHT_RANGE.min, max: HAND_HEIGHT_RANGE.max, noNaN: true }),
});
const time = fc.double({ min: 0, max: 12, noNaN: true });
const trig = fc.double({ min: 0, max: 3, noNaN: true }).map(micro);
const at = (t: number, tt: number, v: Parameters<typeof handPose>[3]) => { const o = new Float64Array(4); handPose(o, t, tt, v); return o; };
const entryOf = (angle: number) => { const e = new Float64Array(2); doorstepEntryPoint(doorstepAzimuth(angle), e); return e; };

describe('hand path', () => {
  it('holds the start pose before the entry time', () => {
    fc.assert(fc.property(values, trig, fc.double({ min: 0, max: 1, noNaN: true }), (v, tt, u) => {
      const t = tt + v.entry * u - (v.entry > 0 ? 1e-9 : 0);
      fc.pre(t - tt - v.entry < 0);
      const p = at(t, tt, v);
      expect(Array.from(p)).toEqual([HAND_START.x, HAND_START.y, HAND_START.z, HAND_START.yaw]);
    }), { numRuns: 300 });
  });

  it('gives the same pose for equal values', () => {
    fc.assert(fc.property(values, trig, time, (v, tt, t) => {
      const a = at(t, tt, v), b = at(t, tt, { ...v });
      for (let k = 0; k < 4; k++) expect(Object.is(a[k], b[k])).toBe(true);
    }), { numRuns: 300 });
  });

  it('starts on the doorstep edge outside the Workspace, approaches the nearest bowl without moving away, and holds there', () => {
    fc.assert(fc.property(values, trig, (v, tt) => {
      const e = entryOf(v.angle);
      expect(inWorkspace(e[0]!, e[1]!, v.height)).toBe(false);
      const start = at(tt + v.entry + 1e-12, tt, v);   // a hair after the entry: (tt + entry) - tt - entry can round to -1e-16
      expect(start[0]).toBeCloseTo(e[0]!, 9);
      expect(start[1]).toBeCloseTo(e[1]!, 9);
      expect(inWorkspace(start[0]!, start[1]!, start[2]!)).toBe(false);
      const bowl = BOWLS[nearestBowl(e[0]!, e[1]!)]!;
      let prev = Math.hypot(start[0]! - bowl.x, start[1]! - bowl.y);
      let prevPos = start;
      for (let k = 1; k <= 60; k++) {
        const p = at(tt + v.entry + k * 0.1, tt, v);
        const d = Math.hypot(p[0]! - bowl.x, p[1]! - bowl.y);
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        // speed never above v
        expect(Math.hypot(p[0]! - prevPos[0]!, p[1]! - prevPos[1]!)).toBeLessThanOrEqual(v.speed * 0.1 + 1e-9);
        expect(p[2]).toBe(v.height);
        prev = d; prevPos = p;
      }
      // long after, at the bowl centre (when it moves at all)
      const late = at(tt + v.entry + 1000, tt, v);
      if (v.speed > 0.001) {
        expect(late[0]).toBeCloseTo(bowl.x, 9); expect(late[1]).toBeCloseTo(bowl.y, 9);
        expect(Array.from(at(tt + v.entry + 2000, tt, v))).toEqual(Array.from(late));   // it holds there
      }
    }), { numRuns: 200 });
  });

  it('enters only on the edge facing away from the base, at 0.05 m to 0.25 m above the Table', () => {
    fc.assert(fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), (a) => {
      const e = entryOf(a);
      expect(e[0]).toBe(TABLE.xMax);
      expect(Math.abs(e[1]!)).toBeLessThanOrEqual(TABLE.yMax + 1e-12);
      expect(WORKSPACE.xMax).toBeLessThan(TABLE.xMax);
    }), { numRuns: 300 });
  });

  it('keeps the arc to 120 degrees and reaches every azimuth of it', () => {
    fc.assert(fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), (a) => {
      expect(Math.abs(doorstepAzimuth(a))).toBeLessThanOrEqual(DOORSTEP.halfAngle + 1e-12);
    }), { numRuns: 300 });
    fc.assert(fc.property(fc.double({ min: -DOORSTEP.halfAngle, max: DOORSTEP.halfAngle, noNaN: true }), (az) => {
      const angle = Math.PI * (az + DOORSTEP.halfAngle) / (2 * DOORSTEP.halfAngle);   // the first leg of the sweep
      expect(doorstepAzimuth(angle)).toBeCloseTo(az, 9);
    }), { numRuns: 300 });
  });

  it('is continuous across the wrap of hand.angle, so a wrapping search sees no jump', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: 0, max: 1e-3, noNaN: true }), (a, d) => {
      expect(Math.abs(doorstepAzimuth(a + d) - doorstepAzimuth(a))).toBeLessThanOrEqual(2 * DOORSTEP.halfAngle / Math.PI * d + 1e-9);
      expect(doorstepAzimuth(a + 2 * Math.PI)).toBeCloseTo(doorstepAzimuth(a), 9);
    }), { numRuns: 300 });
  });

  it('never passes through the base column: the whole path and the forearm stay on the doorstep half of the Table', () => {
    fc.assert(fc.property(values, trig, time, (v, tt, t) => {
      const p = at(t, tt, v);
      // palm and the far end of the forearm (it trails 0.30 m behind the palm, along the yaw)
      const fx = p[0]! + HAND.forearmLength * Math.cos(p[3]!), fy = p[1]! + HAND.forearmLength * Math.sin(p[3]!);
      const minBowlX = Math.min(...BOWLS.map((b) => b.x));
      if (t - tt - v.entry >= 0) expect(p[0]).toBeGreaterThanOrEqual(minBowlX - 1e-9);   // parked before the entry: far from the base anyway
      expect(Math.hypot(p[0]!, p[1]!)).toBeGreaterThan(0.6);       // the Panda base column has a radius well under 0.2 m
      expect(Math.hypot(fx, fy)).toBeGreaterThan(0.6);
    }), { numRuns: 300 });
  });

  it('points the forearm from the palm back toward the entry point, outside the Table', () => {
    fc.assert(fc.property(values, trig, fc.double({ min: 0.05, max: 2, noNaN: true }), (v, tt, dt) => {
      fc.pre(v.speed > 0);
      const e = entryOf(v.angle);
      const p = at(tt + v.entry + dt, tt, v);
      const toEntry = Math.hypot(e[0]! - p[0]!, e[1]! - p[1]!);
      fc.pre(toEntry > 1e-6);
      const dot = Math.cos(p[3]!) * (e[0]! - p[0]!) / toEntry + Math.sin(p[3]!) * (e[1]! - p[1]!) / toEntry;
      expect(dot).toBeCloseTo(1, 6);
    }), { numRuns: 200 });
  });
});