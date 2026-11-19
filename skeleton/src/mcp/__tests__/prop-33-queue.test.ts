import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FifoQueue } from '../queue.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 33: run queue is first in, first out, one at a time', () => {
  // Feature: golem-kit, Property 33: Run queue is first in, first out, one at a time
  it('starts and completes jobs in arrival order, never runs two at once, and skips jobs aborted while queued', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({ ticks: fc.integer({ min: 0, max: 4 }), abortWhileQueued: fc.boolean() }), { minLength: 1, maxLength: 10 }),
      async (jobs) => {
        const q = new FifoQueue();
        const started: number[] = [];
        const finished: number[] = [];
        let maxActive = 0;
        const ctls = jobs.map(() => new AbortController());
        const ps = jobs.map((j, i) => q.run(async () => {
          started.push(i);
          maxActive = Math.max(maxActive, q.active);
          for (let t = 0; t < j.ticks; t++) await Promise.resolve();
          finished.push(i);
        }, (ctls[i] as AbortController).signal).then(() => 'ok', () => 'aborted'));
        // abort the flagged jobs (index 0 may already be running; only those still queued are skipped)
        jobs.forEach((j, i) => { if (j.abortWhileQueued && i > 0) (ctls[i] as AbortController).abort(); });
        const results = await Promise.all(ps);
        const expectRun = jobs.map((j, i) => i === 0 || !j.abortWhileQueued).map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
        expect(started).toEqual(expectRun);
        expect(finished).toEqual(expectRun);
        expect(maxActive).toBeLessThanOrEqual(1);
        jobs.forEach((j, i) => expect(results[i]).toBe(i === 0 || !j.abortWhileQueued ? 'ok' : 'aborted'));
        expect(q.active).toBe(0);
      },
    ), propConfig);
  });
});
