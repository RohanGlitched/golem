import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gateCounter } from '../gate-counter.js';
import type { GateState } from '../types.js';
import { propConfig } from '../../../test/support/prop.js';
import { arbOutside, arbSession } from '../../../test/support/gate-gen.js';

const T = '2026-10-31T04:00:00.000Z';

describe('Property 11: gate counter cycles through five blocks and one allow, without a latch', () => {
  // Feature: golem-kit, Property 11: Gate counter cycles through five blocks and one allow, without a latch
  it('follows the reference cycle per session for any call sequence', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ session: arbSession, green: fc.boolean(), elapsed: arbOutside }), { maxLength: 60 }),
      (calls) => {
        let state: GateState = {};
        const ref = new Map<string, number>();
        const runs = new Map<string, number>();
        for (const c of calls) {
          const r = gateCounter(state, c.session, c.green, T, c.elapsed);
          state = r.nextState;
          if (c.green) { ref.delete(c.session); runs.delete(c.session); expect(r.allowStop).toBe(true); continue; }
          const n = ref.get(c.session) ?? 0;
          if (n < 5) {
            expect(r.allowStop).toBe(false);
            ref.set(c.session, n + 1);
            runs.set(c.session, (runs.get(c.session) ?? 0) + 1);
            expect(runs.get(c.session)).toBeLessThanOrEqual(5);
          } else {
            expect(r.allowStop).toBe(true);
            ref.set(c.session, 0);
            runs.set(c.session, 0);
            expect(state[c.session]?.count).toBe(0);
          }
          expect(state[c.session]?.count).toBe(ref.get(c.session));
        }
      },
    ), propConfig);
  });

  it('blocks calls 1 to 5, allows call 6 and blocks calls 7 to 11 again', () => {
    fc.assert(fc.property(arbSession, (s) => {
      let state: GateState = {};
      const allows: boolean[] = [];
      for (let i = 0; i < 12; i++) { const r = gateCounter(state, s, false, T); allows.push(r.allowStop); state = r.nextState; }
      expect(allows).toEqual([false, false, false, false, false, true, false, false, false, false, false, true]);
    }), propConfig);
  });
});
