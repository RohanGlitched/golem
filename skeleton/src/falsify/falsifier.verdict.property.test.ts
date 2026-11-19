import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbRunCase, loggingPool, optionsOf } from './falsifier.testkit.js';

describe('falsifier verdict soundness', () => {
  // Feature: golem-falsify, Property 16: Verdict soundness
  it('is broken iff some trial was below zero, held iff none and no error, else error', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }), async (c, rejectAt) => {
        const { pool, log } = loggingPool(c.synth, rejectAt === undefined ? {} : { rejectRun: (call) => (call === rejectAt ? new Error('pool down') : undefined) });
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c));
        const negative = log.some((t) => t.robustness < 0);
        if (negative) {
          expect(r.verdict.status).toBe('broken');
          expect(r.verdict.counterexample).toBeDefined();
          expect(r.verdict.counterexample!.robustness).toBeLessThan(0);
        } else {
          expect(r.verdict.counterexample).toBeUndefined();
          const hadError = r.meta.errors.length > 0;
          if (!hadError && log.length > 0) expect(r.verdict.status).toBe('held');
          else expect(r.verdict.status).toBe('error');
        }
      }),
      { numRuns: 200 },
    );
  });
});