import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, PredicateTemplate, Trace } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { deepFreeze, propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}',
  signals: ['z'],
  unit: 'm',
  margin: (s, k) => s.z! - k.threshold!,
};
const wBelow: PredicateTemplate = {
  phrase: 'keep w below {length}',
  signals: ['w'],
  unit: 'm',
  margin: (s, k) => k.limit! - s.w!,
};

const specs = (th: number, dur: number): MonitorSpec[] => [
  { pattern: 'ubiquitous', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always' } },
  { pattern: 'ubiquitous', predicate: above, slots: { threshold: th }, wrapper: { kind: 'eventually', duration: dur } },
  { pattern: 'event', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always', duration: dur } },
  { pattern: 'unwanted', predicate: above, slots: { threshold: th }, wrapper: { kind: 'eventually', duration: dur } },
  {
    pattern: 'state',
    predicate: above,
    slots: { threshold: th },
    wrapper: { kind: 'always' },
    stateMargin: { predicate: wBelow, slots: { limit: 0 } },
  },
  { pattern: 'optional', predicate: above, slots: { threshold: th }, wrapper: { kind: 'always' }, disabledFeature: true },
] as MonitorSpec[];

const arbTr = arbTrace({ signals: ['z', 'w'], maxSamples: 200 });
const arbTh = fc.integer({ min: -20, max: 20 }).map((k) => k / 4);
const arbDur = fc.integer({ min: 1, max: 200 }).map((k) => k / 50);

/**
 * `deepFreeze` from support.ts cannot freeze a non-empty Float64Array (Object.freeze throws
 * "Cannot freeze array buffer views with elements"). Typed arrays are therefore wrapped in a
 * read-only view: a frozen empty target, so deepFreeze treats it as already frozen, whose
 * traps serve reads from the real array and throw on any write. The rest of the graph is
 * frozen with deepFreeze.
 */
function readOnly(a: Float64Array): Float64Array {
  const fail = (): never => { throw new TypeError('write to a read-only trace array'); };
  return new Proxy(Object.freeze({}) as object, {
    get: (_t, key) => (typeof key === 'string' && /^\d+$/.test(key) ? a[Number(key)] : Reflect.get(a, key, a)),
    has: (_t, key) => Reflect.has(a, key),
    set: fail,
    defineProperty: fail,
    deleteProperty: fail,
  }) as unknown as Float64Array;
}

function freezeTrace(tr: Trace): Trace {
  const signals: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(tr.signals)) signals[k] = readOnly(v);
  return deepFreeze({ t: readOnly(tr.t), signals, events: tr.events.map((e) => ({ ...e })) });
}
type R = { robustness: number; worstAt: number; unit: string };
const same = (a: R, b: R): boolean =>
  Object.is(a.robustness, b.robustness) && Object.is(a.worstAt, b.worstAt) && Object.is(a.unit, b.unit);

const copy = (a: Float64Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) out.push(a[i]!);
  return out;
};

const snapshot = (tr: Trace) => ({
  t: copy(tr.t),
  signals: Object.fromEntries(Object.entries(tr.signals).map(([k, v]) => [k, copy(v)])),
  events: tr.events.map((e) => ({ ...e })),
});

/** Wraps `signals` and `events` in proxies that record every key read. */
function spyTrace(tr: Trace): { trace: Trace; sigKeys: Set<string>; evtReads: number } {
  const sigKeys = new Set<string>();
  const state = { evtReads: 0 };
  const signals = new Proxy(tr.signals, {
    get(target, key, recv) {
      if (typeof key === 'string') sigKeys.add(key);
      return Reflect.get(target, key, recv);
    },
  });
  const events = new Proxy(tr.events, {
    get(target, key, recv) {
      state.evtReads++;
      return Reflect.get(target, key, recv);
    },
  });
  return {
    trace: { t: tr.t, signals, events },
    sigKeys,
    get evtReads() { return state.evtReads; },
  };
}

describe('Feature: golem-ears, Property 27: Monitors are pure and read-only', () => {
  it('does not throw on a deep-frozen trace, leaves it unchanged, and repeated calls are bit-identical', () => {
    // **Validates: Requirements 7.1, 7.8, 7.15, 7.16**
    fc.assert(
      fc.property(arbTr, arbTh, arbDur, (tr, th, dur) => {
        const before = snapshot(tr);
        const frozen = freezeTrace(tr);
        for (const spec of specs(th, dur)) {
          const m = buildMonitor(spec);
          const first = m(frozen);
          const second = m(frozen);
          const third = m(frozen);
          expect(same(first, second)).toBe(true);
          expect(same(first, third)).toBe(true);
          // A freshly built monitor agrees with a reused one.
          expect(same(first, buildMonitor(spec)(frozen))).toBe(true);
        }
        expect(snapshot(frozen)).toEqual(before);
      }),
      propConfig,
    );
  });

  it('gives the same results whatever the call order across monitors', () => {
    // **Validates: Requirements 7.1, 7.15, 7.16**
    fc.assert(
      fc.property(arbTr, arbTh, arbDur, fc.infiniteStream(fc.nat(5)), (tr, th, dur, stream) => {
        const frozen = freezeTrace(tr);
        const list = specs(th, dur);
        const monitors = list.map((s) => buildMonitor(s));
        const forward = monitors.map((m) => m(frozen));
        const backward = monitors.map((_, i) => monitors[monitors.length - 1 - i]!(frozen)).reverse();
        const it2 = stream[Symbol.iterator]();
        const shuffled: R[] = [];
        for (let k = 0; k < 12; k++) {
          const i = it2.next().value as number;
          const r = monitors[i]!(frozen);
          expect(same(r, forward[i]!)).toBe(true);
          shuffled.push(r);
        }
        for (let i = 0; i < forward.length; i++) expect(same(forward[i]!, backward[i]!)).toBe(true);
      }),
      propConfig,
    );
  });

  it('a monitor reused across traces gives the same result as a fresh monitor on each trace', () => {
    // **Validates: Requirements 7.8, 7.15, 7.16**
    fc.assert(
      fc.property(fc.array(arbTr, { minLength: 2, maxLength: 4 }), arbTh, arbDur, (traces, th, dur) => {
        const frozen = traces.map((t) => freezeTrace(t));
        for (const spec of specs(th, dur)) {
          const reused = buildMonitor(spec);
          const firstPass = frozen.map((t) => reused(t));
          const reversed = [...frozen].reverse().map((t) => reused(t)).reverse();
          frozen.forEach((t, i) => {
            const fresh = buildMonitor(spec)(t);
            expect(same(firstPass[i]!, fresh)).toBe(true);
            expect(same(reversed[i]!, fresh)).toBe(true);
          });
        }
      }),
      propConfig,
    );
  });

  it('reads signals only through Trace.signals, only the names its predicates declare', () => {
    // **Validates: Requirements 7.1, 7.8**
    fc.assert(
      fc.property(arbTr, arbTh, arbDur, (tr, th, dur) => {
        const frozen = freezeTrace(tr);
        for (const spec of specs(th, dur)) {
          const spy = spyTrace(frozen);
          const res = buildMonitor(spec)(spy.trace);
          expect(same(res, buildMonitor(spec)(frozen))).toBe(true);
          const allowed = new Set([...spec.predicate.signals, ...(spec.stateMargin?.predicate.signals ?? [])]);
          for (const k of spy.sigKeys) expect(allowed.has(k)).toBe(true);
          // Anchors come only from Trace.events, and only for event/unwanted patterns.
          if (spec.pattern !== 'event' && spec.pattern !== 'unwanted') expect(spy.evtReads).toBe(0);
        }
      }),
      propConfig,
    );
  });

  it('does not throw on an empty frozen trace', () => {
    // **Validates: Requirements 7.1, 7.16**
    const empty = freezeTrace({ t: new Float64Array(0), signals: { z: new Float64Array(0), w: new Float64Array(0) }, events: [] });
    for (const spec of specs(0, 1)) {
      const m = buildMonitor(spec);
      expect(same(m(empty), m(empty))).toBe(true);
    }
  });
});
