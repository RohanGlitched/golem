// Feature: candy-app, Property 28: Hand path
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOWLS, HAND_ENTRY_FALLBACK, HAND_HEIGHT_RANGE, HAND_START, WORKSPACE } from '../constants';
import { handPose, inWorkspace, nearestBowl, tableEdgePoint } from '../geometry';

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

  it('starts at a Table-edge point outside the Workspace, approaches the nearest bowl without moving away, and holds there', () => {
    fc.assert(fc.property(values, trig, (v, tt) => {
      const e = new Float64Array(2);
      tableEdgePoint(v.angle, e);
      expect(inWorkspace(e[0]!, e[1]!, v.height)).toBe(false);
      const start = at(tt + v.entry, tt, v);
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
        expect(p[3]).toBe(v.angle);
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

  it('enters on a Table edge: the edge point lies on the Table boundary', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (a) => {
      const e = new Float64Array(2);
      tableEdgePoint(a, e);
      const onBoundary = Math.abs(e[0]! - 1.0) < 1e-9 || Math.abs(e[0]! + 0.2) < 1e-9 || Math.abs(Math.abs(e[1]!) - 0.6) < 1e-9;
      expect(onBoundary).toBe(true);
      expect(e[0]).toBeGreaterThanOrEqual(-0.2 - 1e-9); expect(e[0]).toBeLessThanOrEqual(1.0 + 1e-9);
      expect(Math.abs(e[1]!)).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(WORKSPACE.xMax).toBeLessThan(1.0);
    }), { numRuns: 300 });
  });
});
