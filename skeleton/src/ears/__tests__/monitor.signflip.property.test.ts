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

const spec = (kind: 'always' | 'eventually', threshold: number, tr: Trace): MonitorSpec => {
  // Ubiquitous pattern: the window is the whole trace, so min/max are over every sample.
  const span = tr.t[tr.t.length - 1]! - tr.t[0]!;
  return {
    pattern: 'ubiquitous',
    predicate: above,
    slots: { threshold },
    // within: the deadline is half way, so the hold window runs from there to the last sample.
    wrapper: kind === 'always' ? { kind } : { kind, duration: span / 2 },
  } as MonitorSpec;
};

const arbGap = fc.integer({ min: 1, max: 400 }).map((k) => k / 8);

describe('Feature: golem-ears, Property 23: Sign flips when the threshold crosses the signal', () => {
  it('always: threshold below the window minimum is positive, above it is negative, and restoring returns the sign', () => {
    // **Validates: Requirements 7.13, 13.5**
    fc.assert(
      fc.property(arbTrace(), arbGap, arbGap, (tr, d1, d2) => {
        const z = tr.signals.z!;
        const min = Math.min(...z);
        const run = (th: number) => buildMonitor(spec('always', th, tr))(tr).robustness;
        const base = run(min); // exactly at the minimum: margin 0
        expect(base).toBe(0);
        expect(run(min - d1)).toBeGreaterThan(0);
        expect(run(min + d2)).toBeLessThan(0);
        expect(Math.sign(run(min - d1))).toBe(1);
        // moving the threshold back restores the original sign
        expect(Math.sign(run(min))).toBe(Math.sign(base));
      }),
      propConfig,
    );
  });

  it('within (F then G): threshold below the hold-window minimum is positive, above it is negative', () => {
    // **Validates: Requirements 7.13, 13.5**
    fc.assert(
      fc.property(arbTrace(), arbGap, arbGap, (tr, d1, d2) => {
        const z = tr.signals.z!;
        const deadline = tr.t[0]! + (tr.t[tr.t.length - 1]! - tr.t[0]!) / 2;
        let start = 0;
        for (let i = 0; i < z.length; i++) if (tr.t[i]! <= deadline) start = i;
        let holdMin = Infinity;
        for (let i = start; i < z.length; i++) if (z[i]! < holdMin) holdMin = z[i]!;
        const run = (th: number) => buildMonitor(spec('eventually', th, tr))(tr).robustness;
        expect(run(holdMin)).toBe(0);
        expect(run(holdMin - d1)).toBeGreaterThan(0);
        expect(run(holdMin + d2)).toBeLessThan(0);
        expect(Math.sign(run(holdMin - d1 + d1))).toBe(Math.sign(run(holdMin)));
      }),
      propConfig,
    );
  });

  it('always: crossing the minimum and coming back restores the original robustness', () => {
    // **Validates: Requirements 7.13, 13.5**
    fc.assert(
      fc.property(arbTrace(), fc.integer({ min: -80, max: 80 }).map((k) => k / 4), arbGap, (tr, th, d) => {
        const run = (x: number) => buildMonitor(spec('always', x, tr))(tr).robustness;
        const before = run(th);
        run(th + d);
        expect(run(th)).toBe(before);
      }),
      propConfig,
    );
  });
});
