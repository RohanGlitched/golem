// Feature: candy-app, Property 8: Suction is a pure function
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { suctionForce } from '../controller/suction';

const v3 = fc.tuple(fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true }));

describe('suction purity', () => {
  it('gives bit-identical output for equal inputs and leaves the inputs alone', () => {
    fc.assert(fc.property(v3, v3, v3, v3, fc.double({ min: 0, max: 3, noNaN: true }), (a, b, c, d, cap) => {
      const tip = Float64Array.from(a), vt = Float64Array.from(b), cd = Float64Array.from(c), vc = Float64Array.from(d);
      const o1 = new Float64Array(3), o2 = new Float64Array([7, 7, 7]);
      suctionForce(o1, tip, vt, cd, vc, cap);
      suctionForce(o2, tip, vt, cd, vc, cap);
      expect(Array.from(o1).map(Object.is.bind(null, 0))).toEqual(Array.from(o2).map(Object.is.bind(null, 0)));
      for (let k = 0; k < 3; k++) expect(Object.is(o1[k], o2[k])).toBe(true);
      expect(Array.from(tip)).toEqual(a); expect(Array.from(vt)).toEqual(b);
      expect(Array.from(cd)).toEqual(c); expect(Array.from(vc)).toEqual(d);
    }), { numRuns: 300 });
  });
});
