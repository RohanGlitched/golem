import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbPinnedRows, arbRunCase, loggingPool, optionsOf, pinnedEntries, seedDbOf } from './falsifier.testkit.js';
import type { ProgressEvent } from './types.js';

describe('falsifier progress events', () => {
  // Feature: golem-falsify, Property 26: Progress events
  it('emits one frozen event per Phase 0, generation and Phase 3, in order, and callbacks never change the verdict', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, arbPinnedRows, fc.constantFrom('plain', 'throws', 'rejects', 'never'), async (c, rows, kind) => {
        const run = async (cb?: (e: ProgressEvent) => void | Promise<void>) => {
          const { pool } = loggingPool(c.synth);
          const opts = optionsOf(c, { seedDb: seedDbOf(pinnedEntries(c.space, rows)).db, ...(cb ? { onProgress: cb } : {}) });
          return falsify({ id: 'R1', space: c.space }, pool, opts);
        };
        const events: ProgressEvent[] = [];
        const cb = (e: ProgressEvent): void | Promise<void> => {
          events.push(e);
          if (kind === 'throws') throw new Error('ui bug');
          if (kind === 'rejects') return Promise.reject(new Error('ui bug'));
          if (kind === 'never') return new Promise<void>(() => undefined);
        };
        const r = await run(cb);
        const bare = await run();
        expect({ ...r.verdict, ms: 0 }).toEqual({ ...bare.verdict, ms: 0 });
        expect(events[0]!.phase).toBe(0);
        expect(events.filter((e) => e.phase === 0)).toHaveLength(1);
        expect(events.filter((e) => e.phase === 3).length).toBeLessThanOrEqual(1);
        let prev: ProgressEvent | undefined;
        let used = 0;
        for (const e of events) {
          expect(Object.isFrozen(e)).toBe(true);
          expect(e.scenarios).toHaveLength(e.robustness.length);
          used += e.scenarios.length;
          expect(e.trialsUsed).toBe(used);
          expect(e.trialsRemaining).toBe(Math.max(0, c.maxTrials - used));
          if (prev) {
            expect(e.phase).toBeGreaterThanOrEqual(prev.phase);
            if (e.phase === prev.phase && (e.phase === 1 || e.phase === 2)) expect(e.generation).toBe(prev.generation + 1);
            if (e.phase !== prev.phase && (e.phase === 1 || e.phase === 2)) expect(e.generation).toBe(0);
          }
          prev = e;
        }
        expect(used).toBe(r.verdict.trials);
        if (events.length > 0) expect(events[events.length - 1]!.lowestRobustness).toBe(Math.min(Infinity, ...events.flatMap((e) => [...e.robustness])));
      }),
      { numRuns: 150 },
    );
  });

  it('reports a null trialsRemaining without a trial limit', async () => {
    let t = 0;
    const { pool } = loggingPool({ kind: 'const', value: 1 });
    const events: ProgressEvent[] = [];
    await falsify({ id: 'R1', space: { dims: [{ name: 'x', kind: 'force', min: 0, max: 1, severity: 'up' }] } }, pool, {
      appId: 'a', budget: { maxWallMs: 50 }, searchSeed: 1, clock: () => (t += 1), onProgress: (e) => { events.push(e); },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.trialsRemaining).toBeNull();
  });
});