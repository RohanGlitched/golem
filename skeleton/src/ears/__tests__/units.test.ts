import { describe, it, expect } from 'vitest';
import { UNIT_TABLE, ACCEPTED_UNITS, toSI, fromSI } from '../units.js';

const D = Math.PI / 180;
const EXPECTED: [string, string, number][] = [
  ['N', 'force', 1], ['kN', 'force', 1000],
  ['s', 'duration', 1], ['ms', 'duration', 0.001],
  ['m', 'length', 1], ['cm', 'length', 0.01], ['mm', 'length', 0.001],
  ['m/s', 'speed', 1], ['cm/s', 'speed', 0.01],
  ['deg', 'angle', D], ['°', 'angle', D], ['rad', 'angle', 1],
  ['kg', 'mass', 1], ['g', 'mass', 0.001],
  ['%', 'ratio', 0.01],
];

describe('unit table', () => {
  it('has exactly the fifteen designed units', () => {
    expect(UNIT_TABLE.length).toBe(EXPECTED.length);
    expect([...ACCEPTED_UNITS].sort()).toEqual(EXPECTED.map((e) => e[0]).sort());
  });

  for (const [u, kind, factor] of EXPECTED) {
    it(`lists ${u} as ${kind} with factor ${factor}`, () => {
      const spec = UNIT_TABLE.find((x) => x.spelling === u);
      expect(spec?.kind).toBe(kind);
      expect(spec?.factor).toBe(factor);
      expect(toSI(1, u)).toBe(factor);
    });
  }

  it('rejects n and M as units (case-sensitive)', () => {
    expect(ACCEPTED_UNITS).not.toContain('n');
    expect(ACCEPTED_UNITS).not.toContain('M');
    expect(() => toSI(1, 'n')).toThrow();
    expect(() => fromSI(1, 'M')).toThrow();
  });

  it('converts 200 kN to 200000 N', () => {
    expect(toSI(200, 'kN')).toBe(200000);
    expect(toSI(200, 'kN')).toBe(toSI(200000, 'N'));
  });

  it('fromSI returns exactly 0 for 0', () => {
    for (const u of ACCEPTED_UNITS) expect(Object.is(fromSI(0, u), 0)).toBe(true);
  });

  it('fromSI inverts toSI for a sample', () => {
    expect(fromSI(0.5, 'cm')).toBeCloseTo(50, 12);
    expect(fromSI(Math.PI, 'deg')).toBeCloseTo(180, 10);
  });
});
