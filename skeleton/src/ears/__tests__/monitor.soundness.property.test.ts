import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, PredicateTemplate, Trace } from '../types.js';
import { arbTrace } from './generators.trace.js';
import { propConfig } from './support.js';

const above: PredicateTemplate = {
  phrase: 'keep z above {length}',
  signals: ['z'],
  unit: 'm',
  margin: (s, k) => s.z! - k.threshold!,
};

type Kind = 'always' | 'eventually';

/** Independent check: margins of the samples inside the closed window [a, b], written from the predicate directly. */
function windowMargins(trace: Trace, threshold: number, anchored: boolean, duration: number | undefined): number[] {
  let a = trace.t[0]!;
  if (anchored) a = trace.events.find((e) => e.name === 'trigger')!.t;
  const b = duration === undefined ? trace.t[trace.t.length - 1]! : a + duration;
  const out: number[] = [];
  for (let i = 0; i < trace.t.length; i++) {
    if (trace.t[i]! >= a && trace.t[i]! <= b) out.push(trace.signals.z![i]! - threshold);
  }
  return out;
}

const arbCase = fc.record({
  trace: arbTrace(),
  anchored: fc.boolean(),
  kind: fc.constantFrom<Kind>('always', 'eventually'),
  duration: fc.option(fc.integer({ min: 1, max: 300 }).map((k) => k * 0.01), { nil: undefined }),
  // Quarter steps match the trace value pool, so zero margins occur often.
  threshold: fc.integer({ min: -24, max: 24 }).map((k) => k / 4),
  u: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe('Feature: golem-ears, Property 22: Robustness soundness', () => {
  it('robustness sign matches direct evaluation of the margins over the closed window', () => {
    // **Validates: Requirements 7.11, 7.12, 13.5**
    fc.assert(
      fc.property(arbCase, ({ trace, anchored, kind, duration, threshold, u }) => {
        // eventually needs a duration; an unanchored window starts at t[0].
        const d = kind === 'eventually' ? (duration ?? 0.5) : duration;
        const lo = trace.t[0]!;
        const hi = trace.t[trace.t.length - 1]!;
        const tr: Trace = anchored
          ? { ...trace, events: [{ name: 'trigger', t: lo + u * (hi - lo) }] }
          : { ...trace, events: [] };
        const spec = {
          pattern: anchored ? 'event' : 'ubiquitous',
          predicate: above,
          slots: { threshold },
          wrapper: kind === 'always' ? { kind, duration: d } : { kind, duration: d as number },
        } as MonitorSpec;

        const r = buildMonitor(spec)(tr).robustness;
        const ms = windowMargins(tr, threshold, anchored, d);
        if (ms.length === 0) {
          expect(Number.isNaN(r)).toBe(true);
          return;
        }
        expect(Number.isNaN(r)).toBe(false);
        const holds = kind === 'always' ? ms.every((m) => m > 0) : ms.some((m) => m > 0);
        const violated = kind === 'always' ? ms.some((m) => m < 0) : ms.every((m) => m < 0);
        const extreme = kind === 'always' ? Math.min(...ms) : Math.max(...ms);

        expect(r > 0).toBe(holds);
        expect(r < 0).toBe(violated);
        if (r === 0) expect(extreme).toBe(0);
        expect(r === 0).toBe(extreme === 0);
      }),
      propConfig,
    );
  });

  it('reports exactly 0 at the boundary for an always window that touches the threshold', () => {
    // **Validates: Requirements 7.11, 7.12, 13.5**
    const t = Float64Array.from([0, 1, 2]);
    const trace: Trace = { t, signals: { z: Float64Array.from([2, 1, 3]) }, events: [] };
    const spec = {
      pattern: 'ubiquitous',
      predicate: above,
      slots: { threshold: 1 },
      wrapper: { kind: 'always' },
    } as MonitorSpec;
    const r = buildMonitor(spec)(trace).robustness;
    expect(r).toBe(0);
    expect(r > 0).toBe(false);
    expect(r < 0).toBe(false);
  });
});
