import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explain, pickLowest, signalMargins } from '../margins.js';
import type { PredicateBinding, Trace } from '../../cli/sibling-types.js';
import { propConfig } from '../../../test/support/prop.js';

const names = ['s1', 's2', 's3', 's4'];
const pred = (signals: string[], thr: number): PredicateBinding['predicate'] => ({
  phrase: 'p', signals, unit: 'u',
  margin: (s, slots) => signals.reduce((a, k) => Math.min(a, (s[k] as number) - (slots['thr'] as number)), Infinity) - 0 * thr,
});

const arbCase = fc.record({
  n: fc.integer({ min: 2, max: 20 }),
  values: fc.array(fc.array(fc.integer({ min: -4, max: 4 }), { minLength: 20, maxLength: 20 }), { minLength: 4, maxLength: 4 }),
  bindings: fc.array(fc.record({ signals: fc.subarray(names, { minLength: 1 }), thr: fc.integer({ min: -3, max: 3 }) }), { minLength: 1, maxLength: 3 }),
});

function build(c: { n: number; values: number[][]; bindings: { signals: string[]; thr: number }[] }): { trace: Trace; bindings: PredicateBinding[] } {
  const t = Float64Array.from({ length: c.n }, (_, i) => i * 0.02);
  const signals: Record<string, Float64Array> = {};
  names.forEach((k, j) => { signals[k] = Float64Array.from((c.values[j] as number[]).slice(0, c.n)); });
  return { trace: { t, signals, events: [] }, bindings: c.bindings.map((b) => ({ predicate: pred(b.signals, b.thr), slots: { thr: b.thr } })) };
}

describe('Property 38: explain_margin picks the lowest margin and breaks ties by list order', () => {
  // Feature: golem-kit, Property 38: explain_margin picks the lowest margin and breaks ties by list order
  it('gives one margin per signal in first-appearance order and a minimal pick with list-order ties', () => {
    fc.assert(fc.property(arbCase, (c) => {
      const { trace, bindings } = build(c);
      const ms = signalMargins({ predicates: bindings }, trace) as NonNullable<ReturnType<typeof signalMargins>>;
      const order: string[] = [];
      for (const b of bindings) for (const k of b.predicate.signals) if (!order.includes(k)) order.push(k);
      expect(ms.map((m) => m.signal)).toEqual(order);
      const low = pickLowest(ms);
      const min = Math.min(...ms.map((m) => m.margin));
      expect(low.margin).toBe(min);
      expect(low).toBe(ms.find((m) => m.margin === min));
    }), propConfig);
  });

  it('gives identical results when the monitor margins map equals the recomputed values', () => {
    fc.assert(fc.property(arbCase, (c) => {
      const { trace, bindings } = build(c);
      const ms = signalMargins({ predicates: bindings }, trace) as NonNullable<ReturnType<typeof signalMargins>>;
      const mon = { robustness: Math.min(...ms.map((m) => m.margin)), worstAt: 0, unit: 'u' };
      const a = explain({ predicates: bindings }, trace, mon);
      const b = explain({ predicates: bindings }, trace, { ...mon, margins: Object.fromEntries(ms.map((m) => [m.signal, m.margin])) });
      expect(b.lowest).toEqual(a.lowest);
      expect(b.others).toEqual(a.others);
      expect(a.source).toBe('recomputed');
      expect(b.source).toBe('monitor');
    }), propConfig);
  });
});
