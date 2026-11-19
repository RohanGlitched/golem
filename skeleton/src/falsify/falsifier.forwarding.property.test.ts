import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbPinnedRows, arbRunCase, loggingPool, optionsOf, pinnedEntries, seedDbOf } from './falsifier.testkit.js';
import type { ProgressEvent } from './types.js';

describe('falsifier result forwarding', () => {
  // Feature: golem-falsify, Property 27: Result forwarding
  it('delivers every trial result to onResult once, before its generation event, and ignores a throwing callback', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, fc.boolean(), async (c, throws) => {
        const order: string[] = [];
        const { pool, log } = loggingPool(c.synth, { shuffleSeed: 5 });
        const seen: number[] = [];
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c, {
          onResult: (res) => { seen.push(res.spec.seed); order.push('r'); if (throws) throw new Error('ui bug'); },
          onProgress: (e) => { order.push(`e${e.trialsUsed}`); },
        }));
        expect(seen).toHaveLength(r.verdict.trials);
        expect([...seen].sort((a, b) => a - b)).toEqual(log.map((t) => t.spec.seed).sort((a, b) => a - b));
        let results = 0;
        for (const o of order) {
          if (o === 'r') results++;
          else expect(Number(o.slice(1))).toBe(results);
        }
      }),
      { numRuns: 150 },
    );
  });
});