import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gateCounter } from '../gate-counter.js';
import { propConfig } from '../../../test/support/prop.js';
import { arbIso, arbOutside, arbSession, arbState } from '../../../test/support/gate-gen.js';

describe('Property 12: a green gate deletes the key and restarts the count', () => {
  // Feature: golem-kit, Property 12: A green gate deletes the key and restarts the count
  it('allows the stop, removes exactly that key, leaves the others unchanged, and the next five red calls block', () => {
    fc.assert(fc.property(arbState, arbSession, arbIso, arbOutside, (state, session, now, elapsed) => {
      const g = gateCounter(state, session, true, now, elapsed);
      expect(g.allowStop).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(g.nextState, session)).toBe(false);
      for (const k of Object.keys(state)) if (k !== session) expect(g.nextState[k]).toEqual(state[k]);
      expect(Object.keys(g.nextState).length).toBe(Object.keys(state).filter((k) => k !== session).length);
      let s = g.nextState;
      for (let i = 0; i < 5; i++) {
        const r = gateCounter(s, session, false, now);
        expect(r.allowStop).toBe(false);
        s = r.nextState;
      }
      expect(s[session]?.count).toBe(5);
    }), propConfig);
  });
});
