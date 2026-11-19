import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStopPayload, pruneState } from '../gate-counter.js';
import type { GateState } from '../types.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 15: session id, stored state and pruning', () => {
  // Feature: golem-kit, Property 15: Session id, stored state and pruning
  it('returns a non-empty string session_id from valid JSON, otherwise default', () => {
    fc.assert(fc.property(fc.oneof(
      fc.string(),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      fc.record({ session_id: fc.oneof(fc.string(), fc.integer(), fc.constant(null)), cwd: fc.string() }).map((v) => JSON.stringify(v)),
    ), (raw) => {
      const { sessionId } = parseStopPayload(raw);
      let expected = 'default';
      try {
        const j = JSON.parse(raw) as unknown;
        if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
          const id = (j as Record<string, unknown>)['session_id'];
          if (typeof id === 'string' && id !== '') expected = id;
        }
      } catch { /* default */ }
      expect(sessionId).toBe(expected);
      expect(sessionId).not.toBe('');
    }), propConfig);
  });

  it('keeps exactly the entries at most 7 days old with a valid updatedAt', () => {
    const now = Date.parse('2026-10-31T04:00:00.000Z');
    const age = fc.oneof(fc.integer({ min: -1e9, max: 7 * 86400000 + 5000 }), fc.constantFrom(7 * 86400000, 7 * 86400000 + 1));
    fc.assert(fc.property(fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 5 }), fc.oneof(age, fc.constant('invalid' as const))), { maxLength: 8 }), (items) => {
      const state: GateState = {};
      for (const [k, a] of items) {
        Object.defineProperty(state, k, { value: { count: 1, updatedAt: a === 'invalid' ? 'not a date' : new Date(now - a).toISOString() }, enumerable: true, writable: true, configurable: true });
      }
      const out = pruneState(state, now);
      for (const k of Object.keys(state)) {
        const t = Date.parse((state[k] as { updatedAt: string }).updatedAt);
        const keep = !Number.isNaN(t) && now - t <= 7 * 86400000;
        expect(Object.prototype.hasOwnProperty.call(out, k)).toBe(keep);
      }
    }), propConfig);
  });
});
