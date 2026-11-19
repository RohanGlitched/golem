import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gateCounter } from '../gate-counter.js';
import { propConfig } from '../../../test/support/prop.js';
import { arbInside, arbIso, arbOutside, arbSession, arbState } from '../../../test/support/gate-gen.js';

describe('Property 14: gate counter dedupes two red calls within the window', () => {
  // Feature: golem-kit, Property 14: Gate counter dedupes two red calls within the window
  it('a second red call within 2 s repeats the first decision and state', () => {
    fc.assert(fc.property(arbState, arbSession, arbIso, arbOutside, arbInside, (state, session, now, e1, e2) => {
      const first = gateCounter(state, session, false, now, e1);
      const second = gateCounter(first.nextState, session, false, now, e2);
      expect(second.allowStop).toBe(first.allowStop);
      expect(second.nextState).toEqual(first.nextState);
    }), propConfig);
  });

  it('a deduped call returns its input state and allows only at count 0', () => {
    fc.assert(fc.property(arbState, arbSession, arbIso, arbInside, (state, session, now, elapsed) => {
      fc.pre(Object.prototype.hasOwnProperty.call(state, session));
      const r = gateCounter(state, session, false, now, elapsed);
      expect(r.nextState).toEqual(state);
      expect(r.allowStop).toBe(state[session]?.count === 0);
    }), propConfig);
  });
});
