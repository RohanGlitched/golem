// Step tables, ranges and display-unit conversion for quantity controls.
import { fromSI, toSI } from '../../ears/index.js';
import type { Kind } from '../types.js';

export const STEP: Record<string, number> = {
  N: 1, kN: 0.1, s: 0.1, ms: 10, m: 0.01, cm: 1, mm: 1, 'm/s': 0.05, 'cm/s': 5,
  deg: 5, '\u00b0': 5, rad: 0.05, kg: 0.1, g: 10, '%': 1,
};

export type Modifier = 'none' | 'shift' | 'alt';

export function effectiveStep(unit: string, mod: Modifier): number {
  const base = STEP[unit] ?? 1;
  return base * (mod === 'shift' ? 10 : mod === 'alt' ? 0.1 : 1);
}

export interface Range { min: number; max: number }

/** Allowed display range for a kind and unit. Template limits (display units) narrow it. */
export function rangeOf(kind: Kind, unit: string, limits?: Partial<Range>): Range {
  let r: Range;
  if (kind === 'ratio' || kind === 'phase') r = unit === '%' ? { min: 0, max: 100 } : { min: 0, max: 1 };
  else if (kind === 'angle') r = unit === 'rad' ? { min: 0, max: 2 * Math.PI } : { min: 0, max: 360 };
  else r = { min: 0, max: Infinity };
  const min = Math.min(r.max, Math.max(r.min, limits?.min ?? -Infinity));
  const max = Math.max(min, Math.min(r.max, limits?.max ?? Infinity));
  return { min, max };
}

export function toDisplay(si: number, unit: string): number { return fromSI(si, unit); }
export function fromDisplay(value: number, unit: string): number { return toSI(value, unit); }

/** Display unit per kind for summaries. */
export const DISPLAY_UNIT: Partial<Record<Kind, string>> = {
  force: 'N', duration: 's', length: 'm', speed: 'm/s', mass: 'kg', angle: 'deg', phase: '%', ratio: '%',
};

export function siToDisplayByKind(kind: Kind, si: number): number {
  switch (kind) {
    case 'angle': return (si * 180) / Math.PI;
    case 'phase': case 'ratio': return si * 100;
    default: return si;
  }
}
