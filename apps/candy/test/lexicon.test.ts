import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';
import { dropEveryCandy, keepClear, keepSlow, noDrop, noPress } from '../predicates';

const byPhrase = (p: string) => lexicon.predicates.find((x) => x.phrase === p)!;

describe('lexicon', () => {
  it('lists the robot names arm, Panda and robot', () => {
    expect(lexicon.robotNames).toEqual(['arm', 'Panda', 'robot']);
  });

  it('has the five predicate phrases, exactly, with their signals and units', () => {
    expect(lexicon.predicates.map((p) => [p.phrase, p.unit])).toEqual([
      ['drop every candy into the bowl of its colour within {duration}', 'candies'],
      ['keep every link at least {length} from the hand', 'm'],
      ['keep its fastest link below {speed}', 'm/s'],
      ['not drop a candy outside the bowls', 'candies'],
      ['never press on the table with more than {force}', 'N'],
    ]);
    expect(dropEveryCandy.signals).toEqual(['candies_sorted', 'candies_misplaced', 'candies_dropped_outside', 'candies_active']);
    expect(keepClear.signals).toEqual(['min_link_hand_distance']);
    expect(keepSlow.signals).toEqual(['fastest_link_speed']);
    expect(noDrop.signals).toEqual(['candies_dropped_outside']);
    expect(noPress.signals).toEqual(['table_force']);
  });

  it('has the perturbation phrases of the requirements', () => {
    const phrases = lexicon.perturbations.map((p) => p.phrase);
    for (const p of [
      'a hand reaches in from {direction} at {range:speed}', 'the candies weigh {range:mass}',
      'the vacuum weakens to {range:ratio}', 'the hand tracker lags by {range:duration}', 'candies land anywhere on the tray',
    ]) expect(phrases).toContain(p);
  });

  it('has a margin of min_link_hand_distance - length for the separation line', () => {
    expect(keepClear.margin({ min_link_hand_distance: 0.08 }, { length: 0.10 })).toBeCloseTo(-0.02, 12);
    expect(keepClear.margin({ min_link_hand_distance: 0.6 }, { length: 0.10 })).toBeCloseTo(0.5, 12);
  });
  it('has a margin of speed - fastest_link_speed for the speed line', () => {
    expect(keepSlow.margin({ fastest_link_speed: 0.3 }, { speed: 1.0 })).toBeCloseTo(0.7, 12);
    expect(keepSlow.margin({ fastest_link_speed: 1.2 }, { speed: 1.0 })).toBeCloseTo(-0.2, 12);
  });
  it('has a margin of 0.5 - count for the dropped-candy line: positive only for 0', () => {
    expect(noDrop.margin({ candies_dropped_outside: 0 }, {})).toBe(0.5);
    expect(noDrop.margin({ candies_dropped_outside: 1 }, {})).toBe(-0.5);
  });
  it('has a margin of force - table_force for the table line', () => {
    expect(noPress.margin({ table_force: 20 }, { force: 100 })).toBe(80);
    expect(noPress.margin({ table_force: 120 }, { force: 100 })).toBe(-20);
  });
  it('gives +1 when every candy is sorted and minus the number of unsorted candies otherwise', () => {
    const s = (sorted: number, mis = 0, dropped = 0, active = 6) => ({ candies_sorted: sorted, candies_misplaced: mis, candies_dropped_outside: dropped, candies_active: active });
    expect(dropEveryCandy.margin(s(6), {})).toBe(1);
    expect(dropEveryCandy.margin(s(4, 1, 1), {})).toBe(-2);
    expect(dropEveryCandy.margin(s(0), {})).toBe(-6);
    expect(dropEveryCandy.margin(s(3, 0, 0, 3), {})).toBe(1);
  });
  it('gives -Infinity for a non-finite signal', () => {
    expect(keepClear.margin({ min_link_hand_distance: NaN }, { length: 0.1 })).toBe(-Infinity);
    expect(noDrop.margin({ candies_dropped_outside: Infinity }, {})).toBe(-Infinity);
  });
  it('finds each predicate by phrase', () => {
    for (const p of lexicon.predicates) expect(byPhrase(p.phrase)).toBe(p);
  });
});
