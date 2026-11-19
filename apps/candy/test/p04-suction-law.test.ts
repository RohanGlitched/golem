// Feature: candy-app, Property 4: Suction force is capped, directed, and follows the spring-damper law
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SUCTION } from '../constants';
import { suctionForce } from '../controller/suction';

// Physical scale: no value below a micron (squares of denormals underflow to 0 and say nothing about the law).
const c = (lim: number) => fc.double({ min: -lim, max: lim, noNaN: true }).map((x) => (Math.abs(x) < 1e-6 ? 0 : x));
const v3 = (lim: number) => fc.tuple(c(lim), c(lim), c(lim));
const norm = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('suction law', () => {
  it('never exceeds 3 N times the ratio, keeps the direction, and equals the spring-damper value below the cap', () => {
    fc.assert(fc.property(v3(0.05), v3(0.05), v3(3), v3(3), fc.double({ min: 0, max: 1, noNaN: true }).map((x) => (x < 1e-6 ? 0 : x)), (tip, candy, vt, vc, ratio) => {
      const cap = SUCTION.holdingForce * ratio;
      const out = new Float64Array(3);
      suctionForce(out, tip, vt, candy, vc, cap);
      const raw = [0, 1, 2].map((k) => SUCTION.k * (tip[k]! - candy[k]!) + SUCTION.c * (vt[k]! - vc[k]!));
      const rawMag = norm(raw);
      // Rounding can add one ulp to a scaled vector; below 1e-9 N the relative bound is meaningless (denormals).
      expect(norm(out)).toBeLessThanOrEqual(cap > 1e-9 ? cap * (1 + 1e-12) : 1e-9);
      if (rawMag <= cap) {
        expect(Array.from(out)).toEqual(raw.map((x) => x + 0));
      } else if (rawMag > 0) {
        const dot = (out[0]! * raw[0]! + out[1]! * raw[1]! + out[2]! * raw[2]!) / (norm(out) * rawMag);
        if (norm(out) > 0 && cap > 1e-9) expect(dot).toBeGreaterThan(1 - 1e-9);
        expect(norm(out)).toBeCloseTo(cap, 9);
      }
    }), { numRuns: 500 });
  });

  it('has a maximum of 1.5 N at a ratio of 0.5 and 3 N at a ratio of 1', () => {
    fc.assert(fc.property(v3(0.5), (d) => {
      fc.pre(norm(d) > 0.05);
      const z = [0, 0, 0];
      const a = new Float64Array(3), b = new Float64Array(3);
      suctionForce(a, d, z, z, z, SUCTION.holdingForce * 0.5);
      suctionForce(b, d, z, z, z, SUCTION.holdingForce * 1);
      expect(norm(a)).toBeCloseTo(1.5, 9);
      expect(norm(b)).toBeCloseTo(3, 9);
    }), { numRuns: 100 });
  });
});
