import { describe, expect, it } from 'vitest';
import { elapsedSeconds, gateCounter, parseStopPayload, pruneState } from '../gate-counter.js';
import type { GateState } from '../types.js';

const T0 = '2026-10-31T04:00:00.000Z';

describe('gateCounter', () => {
  it('blocks five times, allows the sixth red call, resets to 0 and blocks the seventh', () => {
    let state: GateState = {};
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const r = gateCounter(state, 's', false, T0);
      results.push(r.allowStop);
      state = r.nextState;
      if (i === 5) expect(state['s']).toEqual({ count: 0, updatedAt: T0 });
    }
    expect(results).toEqual([false, false, false, false, false, true, false]);
    expect(state['s']?.count).toBe(1);
  });

  it('deletes the key on a green gate and keeps other sessions', () => {
    const r = gateCounter({ a: { count: 3, updatedAt: T0 }, b: { count: 1, updatedAt: T0 } }, 'a', true);
    expect(r.allowStop).toBe(true);
    expect(r.nextState).toEqual({ b: { count: 1, updatedAt: T0 } });
  });

  it('counts two sessions apart and a missing session as 0', () => {
    let s = gateCounter({}, 'a', false, T0).nextState;
    s = gateCounter(s, 'b', false, T0).nextState;
    s = gateCounter(s, 'a', false, T0).nextState;
    expect(s).toEqual({ a: { count: 2, updatedAt: T0 }, b: { count: 1, updatedAt: T0 } });
  });

  it('works for the default session', () => {
    expect(gateCounter({}, 'default', false, T0).nextState['default']?.count).toBe(1);
  });

  it('does not advance within the dedupe window and allows only at count 0', () => {
    const st: GateState = { s: { count: 2, updatedAt: T0 } };
    expect(gateCounter(st, 's', false, T0, 0.5)).toEqual({ allowStop: false, nextState: st });
    const zero: GateState = { s: { count: 0, updatedAt: T0 } };
    expect(gateCounter(zero, 's', false, T0, 1.9)).toEqual({ allowStop: true, nextState: zero });
    expect(gateCounter(st, 's', false, T0, 2).nextState['s']?.count).toBe(3);
    expect(gateCounter(st, 's', false, T0, -1).nextState['s']?.count).toBe(3);
  });

  it('never dedupes a green call', () => {
    expect(gateCounter({ s: { count: 2, updatedAt: T0 } }, 's', true, T0, 0.1).nextState).toEqual({});
  });

  it('handles a session id that is an object prototype key', () => {
    const r = gateCounter({}, '__proto__', false, T0);
    expect(Object.keys(r.nextState)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(r.nextState)).toBe(Object.prototype);
  });
});

describe('elapsedSeconds, pruneState and parseStopPayload', () => {
  it('measures seconds from the stored updatedAt', () => {
    expect(elapsedSeconds({ s: { count: 1, updatedAt: T0 } }, 's', Date.parse(T0) + 1500)).toBe(1.5);
    expect(elapsedSeconds({}, 's', 0)).toBeUndefined();
    expect(elapsedSeconds({ s: { count: 1, updatedAt: 'nope' } }, 's', 0)).toBeUndefined();
  });

  it('prunes entries older than 7 days and entries with an invalid updatedAt', () => {
    const now = Date.parse(T0);
    const day = 86400000;
    const s = pruneState({
      fresh: { count: 1, updatedAt: new Date(now - 6 * day).toISOString() },
      edge: { count: 1, updatedAt: new Date(now - 7 * day).toISOString() },
      old: { count: 1, updatedAt: new Date(now - 7 * day - 1).toISOString() },
      bad: { count: 1, updatedAt: 'x' },
    }, now);
    expect(Object.keys(s).sort()).toEqual(['edge', 'fresh']);
  });

  it('takes session_id from a valid payload and nothing else', () => {
    expect(parseStopPayload('{"session_id":"abc","hook_event_name":"Stop","cwd":"/x"}').sessionId).toBe('abc');
    expect(parseStopPayload('{"session_id":""}').sessionId).toBe('default');
    expect(parseStopPayload('{"session_id":3}').sessionId).toBe('default');
    expect(parseStopPayload('not json').sessionId).toBe('default');
    expect(parseStopPayload(undefined).sessionId).toBe('default');
    expect(parseStopPayload('[]').sessionId).toBe('default');
  });
});
