import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTROL_DT, MAX_LAG } from '../constants';
import { DELAY_WIDTH, DelayLine } from '../controller/delay';

const sample = (k: number): Float64Array => Float64Array.from({ length: DELAY_WIDTH }, (_, i) => 10 * k + i);
const filled = (n: number, line = new DelayLine()): DelayLine => { for (let k = 0; k < n; k++) line.push(sample(k)); return line; };
const read = (line: DelayLine, lag: number): Float64Array => { const out = new Float64Array(DELAY_WIDTH); line.read(lag, out); return out; };

describe('DelayLine', () => {
  it('reads the newest sample at lag 0', () => {
    expect(Array.from(read(filled(7), 0))).toEqual(Array.from(sample(6)));
  });
  it('reads zeros before the first push', () => {
    expect(Array.from(read(new DelayLine(), 0.05))).toEqual(new Array(DELAY_WIDTH).fill(0));
  });
  it('reads the sample k control steps back at a lag of k * CONTROL_DT, for any history length', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 79 }), (n, k) => {
      const kk = Math.min(k, n - 1);
      const got = read(filled(n), k * CONTROL_DT);
      const want = sample(n - 1 - kk);
      for (let i = 0; i < DELAY_WIDTH; i++) expect(got[i]).toBeCloseTo(want[i]!, 6);
    }), { numRuns: 200 });
  });
  it('interpolates linearly between two samples', () => {
    fc.assert(fc.property(fc.integer({ min: 5, max: 200 }), fc.integer({ min: 0, max: 60 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, k, f) => {
      const got = read(filled(n), (k + f) * CONTROL_DT);
      const a = sample(n - 1 - Math.min(k, n - 2)), b = sample(n - 2 - Math.min(k, n - 2));
      if (k > n - 2) return;
      for (let i = 0; i < DELAY_WIDTH; i++) expect(got[i]).toBeCloseTo((1 - f) * a[i]! + f * b[i]!, 6);
    }), { numRuns: 200 });
  });
  it('never returns a value older than its history, and never one that is not between two real samples', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), fc.double({ min: -1, max: 5, noNaN: true }), (n, lag) => {
      const got = read(filled(n), lag);
      const lo = sample(0)[0]!, hi = sample(n - 1)[0]!;
      expect(got[0]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(got[0]).toBeLessThanOrEqual(hi + 1e-9);
    }), { numRuns: 200 });
  });
  it('is monotone: a longer lag never reads a newer sample', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 150 }), fc.double({ min: 0, max: MAX_LAG, noNaN: true }), fc.double({ min: 0, max: MAX_LAG, noNaN: true }), (n, a, b) => {
      const line = filled(n);
      const [short, long] = a <= b ? [a, b] : [b, a];
      expect(read(line, long)[0]!).toBeLessThanOrEqual(read(line, short)[0]! + 1e-9);
    }), { numRuns: 200 });
  });
  it('keeps working after the ring wraps around, with the same answers as a line that never wrapped', () => {
    const small = new DelayLine(0.05, CONTROL_DT);
    filled(1000, small);
    const big = filled(1000);
    for (const k of [0, 1, 2, 3, 4]) expect(Array.from(read(small, k * CONTROL_DT))).toEqual(Array.from(read(big, k * CONTROL_DT)));
  });
  it('treats NaN and negative lags as no lag', () => {
    const line = filled(20);
    expect(Array.from(read(line, Number.NaN))).toEqual(Array.from(sample(19)));
    expect(Array.from(read(line, -3))).toEqual(Array.from(sample(19)));
  });
  it('holds at least MAX_LAG of history', () => {
    const line = filled(500);
    expect(read(line, MAX_LAG)[0]).toBeCloseTo(sample(500 - 1 - Math.round(MAX_LAG / CONTROL_DT))[0]!, 6);
  });
});
