import fc from 'fast-check';
import { describe, it } from 'vitest';
import { HandleRegistry } from './handles.js';
import { FakeHandle } from './test-fixtures.js';
import { PURE_RUNS, SEED } from './test-support.js';

// Feature: golem-sim, Property 19: Handle registry counts live handles
describe('HandleRegistry properties', () => {
  it('counts tracked-and-unreleased handles and never deletes twice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ op: fc.constantFrom('track', 'release'), i: fc.integer({ min: 0, max: 4 }) }), { maxLength: 60 }),
        (ops) => {
          const r = new HandleRegistry();
          const pool = Array.from({ length: 5 }, () => new FakeHandle());
          const live = new Set<number>();
          for (const { op, i } of ops) {
            if (op === 'track') { r.track(pool[i]!); live.add(i); }
            else { r.release(pool[i]!); r.release(pool[i]!); live.delete(i); }
            if (r.live !== live.size || r.live < 0) return false;
          }
          return pool.every((h, i) => h.deleteCalls <= ops.filter((o) => o.op === 'track' && o.i === i).length);
        },
      ),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });
});
