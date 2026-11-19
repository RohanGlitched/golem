import { describe, expect, it } from 'vitest';
import { SEED, deepFreeze, propConfig } from './support';

describe('test support', () => {
  it('configures at least 100 runs and a numeric seed', () => {
    expect(propConfig.numRuns).toBeGreaterThanOrEqual(100);
    expect(typeof propConfig.seed).toBe('number');
    expect(propConfig.seed).toBe(SEED);
    expect(Number.isFinite(SEED)).toBe(true);
  });

  it('deep-freezes nested objects and arrays', () => {
    const v = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(v.a)).toBe(true);
    expect(Object.isFrozen(v.a.b)).toBe(true);
    expect(Object.isFrozen(v.a.b[1])).toBe(true);
  });

  it('freezes the object holding a non-empty typed array without throwing on the array', () => {
    const t = new Float64Array([1, 2, 3]);
    const v = deepFreeze({ t, signals: { x: new Float64Array([4]) } });
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.signals)).toBe(true);
    expect(Object.isFrozen(t)).toBe(false);
  });
});
