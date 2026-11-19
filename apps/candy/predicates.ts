// The five Candy predicates. Each margin is positive when the predicate holds and is measured in the predicate's
// unit, so robustness reads as a physical distance from failure. A margin is a pure function of its inputs and
// returns -Infinity when any input is not finite.
import type { PredicateTemplate } from './contract';

const finite = (...v: number[]): boolean => v.every(Number.isFinite);

/**
 * `drop every candy into the bowl of its colour within {duration}`: with n = candies_active - candies_sorted, the
 * margin is +1 when n is 0 and -n otherwise (unit: candies). The monitor takes the maximum over the window
 * ("eventually"), so the line holds if every candy is sorted at some instant. Candies that are misplaced or dropped
 * are not sorted, so they count in n.
 */
export const dropEveryCandy: PredicateTemplate = {
  phrase: 'drop every candy into the bowl of its colour within {duration}',
  signals: ['candies_sorted', 'candies_misplaced', 'candies_dropped_outside', 'candies_active'],
  unit: 'candies',
  margin: (s) => {
    const sorted = s['candies_sorted'] as number, mis = s['candies_misplaced'] as number;
    const dropped = s['candies_dropped_outside'] as number, active = s['candies_active'] as number;
    if (!finite(sorted, mis, dropped, active)) return -Infinity;
    const n = active - sorted;
    return n === 0 ? 1 : -n;
  },
};

/** `keep every link at least {length} from the hand`: `min_link_hand_distance - length`, in m. */
export const keepClear: PredicateTemplate = {
  phrase: 'keep every link at least {length} from the hand',
  signals: ['min_link_hand_distance'],
  unit: 'm',
  margin: (s, slots) => {
    const d = s['min_link_hand_distance'] as number, length = slots['length'] as number;
    return finite(d, length) ? d - length : -Infinity;
  },
};

/** `keep its fastest link below {speed}`: `speed - fastest_link_speed`, in m/s. */
export const keepSlow: PredicateTemplate = {
  phrase: 'keep its fastest link below {speed}',
  signals: ['fastest_link_speed'],
  unit: 'm/s',
  margin: (s, slots) => {
    const v = s['fastest_link_speed'] as number, limit = slots['speed'] as number;
    return finite(v, limit) ? limit - v : -Infinity;
  },
};

/** `not drop a candy outside the bowls`: `0.5 - candies_dropped_outside`, positive only when the count is 0. */
export const noDrop: PredicateTemplate = {
  phrase: 'not drop a candy outside the bowls',
  signals: ['candies_dropped_outside'],
  unit: 'candies',
  margin: (s) => {
    const n = s['candies_dropped_outside'] as number;
    return Number.isFinite(n) ? 0.5 - n : -Infinity;
  },
};

/** `never press on the table with more than {force}`: `force - table_force`, in N. */
export const noPress: PredicateTemplate = {
  phrase: 'never press on the table with more than {force}',
  signals: ['table_force'],
  unit: 'N',
  margin: (s, slots) => {
    const f = s['table_force'] as number, limit = slots['force'] as number;
    return finite(f, limit) ? limit - f : -Infinity;
  },
};

export const predicates: PredicateTemplate[] = [dropEveryCandy, keepClear, keepSlow, noDrop, noPress];
