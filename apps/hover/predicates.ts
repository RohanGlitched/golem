// The three hover predicates. Each margin is positive when the predicate holds and is measured in the predicate's
// unit, so robustness reads as a physical distance from failure. A margin is a pure function of its inputs and
// returns -Infinity when any input is not finite.
import type { PredicateTemplate } from './contract';

const RAD2DEG = 180 / Math.PI;
const finite = (...v: number[]): boolean => v.every(Number.isFinite);

/** `stay within {length} of its hover point`: `length - hover_distance`, in m. */
export const stayWithin: PredicateTemplate = {
  phrase: 'stay within {length} of its hover point',
  signals: ['hover_distance'],
  unit: 'm',
  margin: (s, slots) => {
    const d = s['hover_distance'] as number, length = slots['length'] as number;
    return finite(d, length) ? length - d : -Infinity;
  },
};

/** `keep its tilt below {angle}`: `angle - tilt_deg`, in deg. The angle slot is in rad (SI). */
export const keepTiltBelow: PredicateTemplate = {
  phrase: 'keep its tilt below {angle}',
  signals: ['tilt_deg'],
  unit: 'deg',
  margin: (s, slots) => {
    const tilt = s['tilt_deg'] as number, angle = slots['angle'] as number;
    return finite(tilt, angle) ? angle * RAD2DEG - tilt : -Infinity;
  },
};

/** `stay above {length}`: `altitude - length`, in m. */
export const stayAbove: PredicateTemplate = {
  phrase: 'stay above {length}',
  signals: ['altitude'],
  unit: 'm',
  margin: (s, slots) => {
    const z = s['altitude'] as number, length = slots['length'] as number;
    return finite(z, length) ? z - length : -Infinity;
  },
};

export const predicates: PredicateTemplate[] = [stayWithin, keepTiltBelow, stayAbove];
