import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keepTiltBelow, predicates, stayAbove, stayWithin } from '../predicates';

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const DEG = Math.PI / 180;

describe('stayWithin', () => {
  it('has the margin length - hover_distance, in m', () => {
    expect(stayWithin.unit).toBe('m');
    expect(stayWithin.margin({ hover_distance: 0.1 }, { length: 0.25 })).toBeCloseTo(0.15, 12);
    expect(stayWithin.margin({ hover_distance: 0.4 }, { length: 0.25 })).toBeCloseTo(-0.15, 12);
  });
  it('is positive exactly when the drone is inside the ball', () => {
    fc.assert(fc.property(num(0, 5), num(0.01, 5), (d, length) => {
      const m = stayWithin.margin({ hover_distance: d }, { length });
      expect(m > 0).toBe(d < length);
    }), { numRuns: 300 });
  });
  it('never rises when the distance grows, and rises when the allowed length grows', () => {
    fc.assert(fc.property(num(0, 5), num(0, 5), num(0.01, 5), (a, b, length) => {
      const [near, far] = a <= b ? [a, b] : [b, a];
      expect(stayWithin.margin({ hover_distance: far }, { length })).toBeLessThanOrEqual(stayWithin.margin({ hover_distance: near }, { length }));
      expect(stayWithin.margin({ hover_distance: near }, { length: length + 1 })).toBeGreaterThan(stayWithin.margin({ hover_distance: near }, { length }));
    }), { numRuns: 200 });
  });
});

describe('keepTiltBelow', () => {
  it('reads the angle slot in rad and the signal in deg, and answers in deg', () => {
    expect(keepTiltBelow.unit).toBe('deg');
    expect(keepTiltBelow.margin({ tilt_deg: 20 }, { angle: 30 * DEG })).toBeCloseTo(10, 9);
  });
  it('is positive exactly when the tilt is below the limit, and the sign flips when the limit crosses the tilt', () => {
    fc.assert(fc.property(num(0, 180), num(1, 90), (tilt, limit) => {
      const m = keepTiltBelow.margin({ tilt_deg: tilt }, { angle: limit * DEG });
      if (Math.abs(tilt - limit) > 1e-6) expect(m > 0).toBe(tilt < limit);
      expect(keepTiltBelow.margin({ tilt_deg: tilt }, { angle: (tilt + 1) * DEG })).toBeGreaterThan(0);
      if (tilt >= 1) expect(keepTiltBelow.margin({ tilt_deg: tilt }, { angle: (tilt - 1) * DEG })).toBeLessThan(0);
    }), { numRuns: 300 });
  });
});

describe('stayAbove', () => {
  it('has the margin altitude - length, in m', () => {
    expect(stayAbove.unit).toBe('m');
    expect(stayAbove.margin({ altitude: 0.8 }, { length: 0.5 })).toBeCloseTo(0.3, 12);
  });
  it('is monotone: raising the threshold never raises the margin, and the sign flips as the threshold crosses the altitude', () => {
    fc.assert(fc.property(num(-1, 3), num(0, 3), num(0, 3), (z, a, b) => {
      const [low, high] = a <= b ? [a, b] : [b, a];
      expect(stayAbove.margin({ altitude: z }, { length: high })).toBeLessThanOrEqual(stayAbove.margin({ altitude: z }, { length: low }));
      expect(stayAbove.margin({ altitude: z }, { length: z - 0.01 })).toBeGreaterThan(0);
      expect(stayAbove.margin({ altitude: z }, { length: z + 0.01 })).toBeLessThan(0);
    }), { numRuns: 300 });
  });
});

describe('every predicate', () => {
  it('returns -Infinity for a signal or slot that is not finite', () => {
    for (const [p, signal, slot] of [[stayWithin, 'hover_distance', 'length'], [keepTiltBelow, 'tilt_deg', 'angle'], [stayAbove, 'altitude', 'length']] as const) {
      for (const bad of [Number.NaN, Infinity, -Infinity]) {
        expect(p.margin({ [signal]: bad }, { [slot]: 1 })).toBe(-Infinity);
        expect(p.margin({ [signal]: 1 }, { [slot]: bad })).toBe(-Infinity);
      }
    }
  });
  it('reads only the signals it declares', () => {
    expect(predicates.map((p) => p.signals)).toEqual([['hover_distance'], ['tilt_deg'], ['altitude']]);
  });
});
