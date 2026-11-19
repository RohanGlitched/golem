// Feature: candy-app, Property 24: Candy classification and workspace test
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOWLS, DROPPED_Z, TRAY, WORKSPACE } from '../constants';
import { bowlAt, classifyCandies, inTray, inWorkspace, type CandyCounts, type CandyState } from '../geometry';

const candy: fc.Arbitrary<CandyState> = fc.record({
  x: fc.double({ min: -0.8, max: 1.2, noNaN: true }),
  y: fc.double({ min: -0.8, max: 0.8, noNaN: true }),
  z: fc.double({ min: -0.4, max: 0.3, noNaN: true }),
  speed: fc.double({ min: 0, max: 0.2, noNaN: true }),
  colour: fc.integer({ min: 0, max: 2 }),
  active: fc.boolean(),
});
/** Candies that sit in a bowl or near it, so that the sorted and misplaced branches are exercised. */
const nearBowl: fc.Arbitrary<CandyState> = fc.tuple(fc.integer({ min: 0, max: 2 }), fc.double({ min: -0.08, max: 0.08, noNaN: true }), fc.double({ min: -0.08, max: 0.08, noNaN: true }), fc.double({ min: 0, max: 0.07, noNaN: true }), fc.double({ min: 0, max: 0.2, noNaN: true }), fc.integer({ min: 0, max: 2 }), fc.boolean())
  .map(([b, dx, dy, z, speed, colour, active]) => ({ x: BOWLS[b]!.x + dx, y: BOWLS[b]!.y + dy, z, speed, colour, active }));
const six = fc.array(fc.oneof(candy, nearBowl), { minLength: 6, maxLength: 6 });
const fresh = (): CandyCounts => ({ sorted: 0, misplaced: 0, droppedOutside: 0, active: 0 });

describe('candy classification', () => {
  it('keeps sorted + misplaced + dropped within the active count and counts only resting candies in bowls', () => {
    fc.assert(fc.property(six, (cs) => {
      const r = classifyCandies(cs, fresh());
      expect(r.sorted + r.misplaced + r.droppedOutside).toBeLessThanOrEqual(r.active);
      expect(r.active).toBe(cs.filter((c) => c.active).length);
      // oracle
      let sorted = 0, mis = 0, dropped = 0;
      for (const c of cs) {
        if (!c.active) continue;
        const b = bowlAt(c.x, c.y, c.z);
        if (b >= 0 && c.speed <= 0.05) { if (b === c.colour) sorted++; else mis++; }
        if (b < 0 && c.z <= DROPPED_Z && !(c.x >= TRAY.xMin && c.x <= TRAY.xMax && c.y >= TRAY.yMin && c.y <= TRAY.yMax)) dropped++;
      }
      expect(r).toEqual({ sorted, misplaced: mis, droppedOutside: dropped, active: r.active });
    }), { numRuns: 500 });
  });

  it('never counts a candy faster than 0.05 m/s as sorted or misplaced', () => {
    fc.assert(fc.property(six, (cs) => {
      const fast = cs.map((c) => ({ ...c, speed: 0.0501 + c.speed }));
      const r = classifyCandies(fast, fresh());
      expect(r.sorted).toBe(0);
      expect(r.misplaced).toBe(0);
    }), { numRuns: 200 });
  });

  it('counts a low candy outside every bowl and the tray as dropped, and a candy above 0.04 m as not dropped', () => {
    fc.assert(fc.property(candy, (c) => {
      const s = { ...c, active: true };
      const r = classifyCandies([s], fresh());
      const outside = bowlAt(s.x, s.y, s.z) < 0 && !inTray(s.x, s.y);
      expect(r.droppedOutside).toBe(outside && s.z <= DROPPED_Z ? 1 : 0);
      if (s.z > DROPPED_Z && bowlAt(s.x, s.y, s.z) < 0) expect(r.droppedOutside).toBe(0);
    }), { numRuns: 500 });
  });

  it('tests the workspace box by the palm centre', () => {
    fc.assert(fc.property(fc.double({ min: -0.5, max: 1.5, noNaN: true }), fc.double({ min: -1, max: 1.5, noNaN: true }), fc.double({ min: -0.2, max: 0.8, noNaN: true }), (x, y, z) => {
      const inside = x >= WORKSPACE.xMin && x <= WORKSPACE.xMax && y >= WORKSPACE.yMin && y <= WORKSPACE.yMax && z >= WORKSPACE.zMin && z <= WORKSPACE.zMax;
      expect(inWorkspace(x, y, z)).toBe(inside);
    }), { numRuns: 500 });
  });
});
