// Feature: candy-app, Property 16: Candy selection depends only on positions and ids
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TRAY } from '../constants';
import { chooseCandy } from '../geometry';

const spot = fc.oneof(
  fc.tuple(fc.double({ min: TRAY.xMin, max: TRAY.xMax, noNaN: true }), fc.double({ min: TRAY.yMin, max: TRAY.yMax, noNaN: true }), fc.double({ min: 0, max: 0.03, noNaN: true })),
  fc.tuple(fc.double({ min: -0.5, max: 1.2, noNaN: true }), fc.double({ min: -0.7, max: 0.7, noNaN: true }), fc.double({ min: -0.4, max: 0.3, noNaN: true })),
);
const scene = fc.tuple(fc.array(spot, { minLength: 6, maxLength: 6 }), fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }));

function oracle(p: number[][], active: boolean[], skip: boolean[]): number {
  const cands = [0, 1, 2, 3, 4, 5].filter((i) => active[i] && !skip[i] && p[i]![0]! >= TRAY.xMin && p[i]![0]! <= TRAY.xMax && p[i]![1]! >= TRAY.yMin && p[i]![1]! <= TRAY.yMax && p[i]![2]! <= 0.04);
  if (cands.length === 0) return -1;
  const q = (i: number) => Math.floor(1000 * Math.hypot(p[i]![0]!, p[i]![1]!));
  return cands.reduce((best, i) => (q(i) < q(best) ? i : best), cands[0]!);
}

describe('candy selection', () => {
  it('returns the nearest eligible candy by whole millimetres, the lower id on ties, and -1 when none', () => {
    fc.assert(fc.property(scene, ([p, a, s]) => {
      const pos = Float64Array.from(p.flat());
      const r = chooseCandy(pos, Uint8Array.from(a.map(Number)), Uint8Array.from(s.map(Number)));
      expect(r).toBe(oracle(p, a, s));
    }), { numRuns: 1000 });
  });

  it('is the same for repeated calls and unaffected by changes to candies that are not eligible', () => {
    fc.assert(fc.property(scene, spot, ([p, a, s], other) => {
      const pos = Float64Array.from(p.flat());
      const act = Uint8Array.from(a.map(Number)), skip = Uint8Array.from(s.map(Number));
      const r = chooseCandy(pos, act, skip);
      expect(chooseCandy(pos, act, skip)).toBe(r);
      // move every ineligible candy somewhere else: the answer does not change
      const p2 = p.map((c, i) => (a[i] && !s[i] && c[0]! >= TRAY.xMin && c[0]! <= TRAY.xMax && c[1]! >= TRAY.yMin && c[1]! <= TRAY.yMax && c[2]! <= 0.04 ? c : other));
      const moved = Float64Array.from(p2.flat());
      const eligibleMoved = p2.some((c, i) => c === other && a[i] && !s[i] && c[0]! >= TRAY.xMin && c[0]! <= TRAY.xMax && c[1]! >= TRAY.yMin && c[1]! <= TRAY.yMax && c[2]! <= 0.04);
      if (!eligibleMoved) expect(chooseCandy(moved, act, skip)).toBe(r);
    }), { numRuns: 300 });
  });
});
