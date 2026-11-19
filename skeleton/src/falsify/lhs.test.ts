import { describe, expect, it } from 'vitest';
import type { ScenarioSpace } from './contract.js';
import { latinHypercube, prevDouble } from './lhs.js';

const space: ScenarioSpace = {
  dims: [
    { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' },
    { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
    { name: 'push.duration', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};

describe('latinHypercube', () => {
  it('returns [] for n = 0', () => {
    expect(latinHypercube(space, 0, 1, 0)).toEqual([]);
  });
  it('rejects negative, fractional and NaN n and names the value', () => {
    expect(() => latinHypercube(space, -1, 1, 0)).toThrow(/n=-1/);
    expect(() => latinHypercube(space, 1.5, 1, 0)).toThrow(/n=1.5/);
    expect(() => latinHypercube(space, NaN, 1, 0)).toThrow(/n=NaN/);
  });
  it('rejects a NaN bound and a reversed range and names the dimension', () => {
    const nan: ScenarioSpace = { dims: [{ name: 'x.bad', kind: 'force', min: NaN, max: 1, severity: 'up' }] };
    expect(() => latinHypercube(nan, 4, 1, 0)).toThrow(/x\.bad/);
    const rev: ScenarioSpace = { dims: [{ name: 'x.rev', kind: 'force', min: 2, max: 1, severity: 'up' }] };
    expect(() => latinHypercube(rev, 4, 1, 0)).toThrow(/x\.rev/);
  });
  it('puts one sample in each stratum and fixes the fixed dimension', () => {
    const n = 20;
    const s = latinHypercube(space, n, 7, 0);
    expect(s).toHaveLength(n);
    const strata = new Set(s.map((x) => Math.floor((x['push.force'] as number) / 200 * n)));
    expect(strata.size).toBe(n);
    for (const x of s) expect(x['push.duration']).toBe(0.2);
    expect(Object.keys(s[0]!)).toEqual(['push.force', 'push.angle', 'push.duration']);
  });
  it('handles an all-fixed space', () => {
    const fixed: ScenarioSpace = { dims: [{ name: 'a', kind: 'force', min: 3, max: 3, severity: 'none' }] };
    expect(latinHypercube(fixed, 3, 1, 0)).toEqual([{ a: 3 }, { a: 3 }, { a: 3 }]);
  });
  it('never returns max for a wrap dimension', () => {
    for (let g = 0; g < 50; g++) {
      for (const x of latinHypercube(space, 64, g, g)) {
        expect(x['push.angle']).toBeGreaterThanOrEqual(0);
        expect(x['push.angle']).toBeLessThan(2 * Math.PI);
      }
    }
  });
  it('is deterministic and varies with generation', () => {
    expect(latinHypercube(space, 8, 5, 2)).toEqual(latinHypercube(space, 8, 5, 2));
    expect(latinHypercube(space, 8, 5, 2)).not.toEqual(latinHypercube(space, 8, 5, 3));
  });
  it('prevDouble steps down one ulp', () => {
    expect(prevDouble(1)).toBeLessThan(1);
    expect(prevDouble(1)).toBe(1 - 2 ** -53);
    expect(prevDouble(0)).toBeLessThan(0);
  });
});
