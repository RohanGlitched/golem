import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gateCounter } from '../gate-counter.js';
import { propConfig } from '../../../test/support/prop.js';
import { arbInside, arbIso, arbOutside, arbSession, arbState } from '../../../test/support/gate-gen.js';

const deepFreeze = <T>(o: T): T => {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

describe('Property 13: gate counter is pure and sessions are independent', () => {
  // Feature: golem-kit, Property 13: Gate counter is pure and sessions are independent
  it('does not mutate its input, is deterministic, and changes no other session key', () => {
    fc.assert(fc.property(arbState, arbSession, fc.boolean(), arbIso, fc.oneof(arbOutside, arbInside), (state, session, green, now, elapsed) => {
      const before = JSON.stringify(state);
      deepFreeze(state);
      const a = gateCounter(state, session, green, now, elapsed);
      const b = gateCounter(state, session, green, now, elapsed);
      expect(a).toEqual(b);
      expect(JSON.stringify(state)).toBe(before);
      expect(a.nextState).not.toBe(state);
      for (const k of new Set([...Object.keys(state), ...Object.keys(a.nextState)])) {
        if (k !== session) expect(a.nextState[k]).toEqual(state[k]);
      }
    }), propConfig);
  });
});
