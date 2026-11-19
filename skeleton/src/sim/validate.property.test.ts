import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SimError } from './errors.js';
import { liveHandleCount } from './handles.js';
import { PURE_RUNS, SEED } from './test-support.js';
import type { Dimension } from './types.js';
import { miniApp, miniReq, miniSpec } from './test-fixtures.js';
import { normaliseScenario, validateTrial } from './validate.js';

// Feature: golem-sim, Property 10: Scenario normalisation
describe('normaliseScenario properties', () => {
  const dim = fc
    .record({
      min: fc.double({ min: -1000, max: 1000, noNaN: true }),
      span: fc.double({ min: 0.001, max: 1000, noNaN: true }),
      wrap: fc.boolean(),
    })
    .map(({ min, span, wrap }): Dimension => ({ name: 'd', kind: 'length', min, max: min + span, severity: 'up', wrap }));

  it('passes in-range values on unchanged', () => {
    fc.assert(fc.property(dim, fc.double({ min: 0, max: 1, noNaN: true }), (d, u) => {
      const v = Math.min(d.max, Math.max(d.min, d.min + u * (d.max - d.min)));
      if (d.wrap && v >= d.max) return true;
      return normaliseScenario(d, v) === v;
    }), { numRuns: PURE_RUNS, seed: SEED });
  });
  it('clamps values within 1e-9 relative error outside the range', () => {
    fc.assert(fc.property(dim.filter((d) => !d.wrap), fc.boolean(), (d, hi) => {
      const scale = Math.max(Math.abs(d.min), Math.abs(d.max)) || 1;
      const v = hi ? d.max + 0.5e-9 * scale : d.min - 0.5e-9 * scale;
      const out = normaliseScenario(d, v);
      return out >= d.min && out <= d.max;
    }), { numRuns: PURE_RUNS, seed: SEED });
  });
  it('wraps into [min, max) congruent modulo the span', () => {
    fc.assert(fc.property(dim.filter((d) => d.wrap === true), fc.double({ min: -5000, max: 5000, noNaN: true }), (d, x) => {
      const out = normaliseScenario(d, x);
      if (!(out >= d.min && out < d.max)) return false;
      const k = (x - out) / (d.max - d.min);
      return Math.abs(k - Math.round(k)) < 1e-6;
    }), { numRuns: PURE_RUNS, seed: SEED });
  });
  it('rejects values far outside a non-wrapping range, naming the dimension', () => {
    fc.assert(fc.property(dim.filter((d) => !d.wrap), fc.boolean(), (d, hi) => {
      const v = hi ? d.max + 1 + Math.abs(d.max) : d.min - 1 - Math.abs(d.min);
      try { normaliseScenario(d, v); return false; } catch (e) { return e instanceof SimError && e.message.includes('d = '); }
    }), { numRuns: PURE_RUNS, seed: SEED });
  });
  it('rejects missing and non-finite scenario values before any handle exists', () => {
    const before = liveHandleCount();
    fc.assert(fc.property(fc.constantFrom(NaN, Infinity, -Infinity, undefined), (bad) => {
      const scenario: any = { 'push.force': bad, 'push.angle': 0 };
      try { validateTrial(miniApp(), miniReq(), miniSpec({ scenario })); return false; } catch { return liveHandleCount() === before; }
    }), { numRuns: PURE_RUNS, seed: SEED });
    expect(liveHandleCount()).toBe(before);
  });
});


