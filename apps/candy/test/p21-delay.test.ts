// Feature: candy-app, Property 21: Delay line reads the sample `lag` steps earlier
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HandDelay } from '../controller/hand-delay';

const sample = fc.tuple(fc.double({ noNaN: true }), fc.double({ noNaN: true }), fc.double({ noNaN: true }), fc.double({ noNaN: true }));

describe('hand delay line', () => {
  it('reads the sample clamp(round(lag / 0.02), 0, 15) steps older than the newest, and never grows', () => {
    fc.assert(fc.property(fc.array(sample, { minLength: 16, maxLength: 80 }), fc.double({ min: 0, max: 0.3, noNaN: true }), (seq, lag) => {
      const d = new HandDelay();
      for (const s of seq) d.push(s[0], s[1], s[2], s[3]);
      const steps = Math.min(15, Math.max(0, Math.round(lag / 0.02)));
      expect(HandDelay.steps(lag)).toBe(steps);
      const out = new Float64Array(4);
      d.read(steps, out);
      const expected = seq[seq.length - 1 - steps]!;
      expect(Array.from(out).map((v, k) => Object.is(v, expected[k]))).toEqual([true, true, true, true]);
      if (lag === 0) { d.read(0, out); expect(Array.from(out)).toEqual(Array.from(seq[seq.length - 1]!)); }
      expect(d.buffer.length).toBe(64);
    }), { numRuns: 300 });
  });

  it('returns the newest sample for lag 0 after any number of pushes', () => {
    fc.assert(fc.property(fc.array(sample, { minLength: 1, maxLength: 60 }), (seq) => {
      const d = new HandDelay();
      for (const s of seq) d.push(s[0], s[1], s[2], s[3]);
      const out = new Float64Array(4);
      d.read(HandDelay.steps(0), out);
      expect(Array.from(out)).toEqual(Array.from(seq[seq.length - 1]!));
    }), { numRuns: 200 });
  });
});
