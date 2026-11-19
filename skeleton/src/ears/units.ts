import type { Kind } from './types.js';

export interface UnitSpec { spelling: string; kind: Kind; factor: number }

const DEG = Math.PI / 180;

/** Accepted unit spellings with kind and factor to SI. Matching is case-sensitive. */
export const UNIT_TABLE: readonly UnitSpec[] = Object.freeze([
  { spelling: 'N', kind: 'force', factor: 1 },
  { spelling: 'kN', kind: 'force', factor: 1000 },
  { spelling: 's', kind: 'duration', factor: 1 },
  { spelling: 'ms', kind: 'duration', factor: 0.001 },
  { spelling: 'm', kind: 'length', factor: 1 },
  { spelling: 'cm', kind: 'length', factor: 0.01 },
  { spelling: 'mm', kind: 'length', factor: 0.001 },
  { spelling: 'm/s', kind: 'speed', factor: 1 },
  { spelling: 'cm/s', kind: 'speed', factor: 0.01 },
  { spelling: 'deg', kind: 'angle', factor: DEG },
  { spelling: '°', kind: 'angle', factor: DEG },
  { spelling: 'rad', kind: 'angle', factor: 1 },
  { spelling: 'kg', kind: 'mass', factor: 1 },
  { spelling: 'g', kind: 'mass', factor: 0.001 },
  { spelling: '%', kind: 'ratio', factor: 0.01 },
] as UnitSpec[]);

export const ACCEPTED_UNITS: readonly string[] = Object.freeze(UNIT_TABLE.map((u) => u.spelling));

const BY_SPELLING: ReadonlyMap<string, UnitSpec> = new Map(UNIT_TABLE.map((u) => [u.spelling, u]));

/** The table entry for a spelling (case-sensitive), or undefined. */
export function lookupUnit(unit: string): UnitSpec | undefined {
  return BY_SPELLING.get(unit);
}

function need(unit: string): UnitSpec {
  const spec = BY_SPELLING.get(unit);
  if (!spec) throw new Error(`Unknown unit "${unit}". Accepted units: ${ACCEPTED_UNITS.join(', ')}`);
  return spec;
}

/** Multiply by the unit factor. Throws on an unknown unit. */
export function toSI(value: number, unit: string): number {
  return value * need(unit).factor;
}

/** Divide by the unit factor. 0 returns exactly 0. Throws on an unknown unit. */
export function fromSI(si: number, unit: string): number {
  const spec = need(unit);
  if (si === 0) return 0;
  return si / spec.factor;
}
