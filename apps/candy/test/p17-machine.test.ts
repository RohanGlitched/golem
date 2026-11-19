// Feature: candy-app, Property 17: Transition table is enumerable and total
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STATES, TRANSITIONS, makeGuards, next, type Guards, type StateId } from '../controller/machine';

const guards: fc.Arbitrary<Guards> = fc.record({
  candidate: fc.boolean(), ikFail: fc.boolean(), atAbove: fc.boolean(), nearCandy: fc.boolean(), lost: fc.boolean(),
  dwellDone: fc.boolean(), lifted: fc.boolean(), atBowl: fc.boolean(), homeReached: fc.boolean(),
});
const state = fc.constantFrom(...STATES);

describe('transition table', () => {
  it('returns at most one transition, from the right state, to a known state', () => {
    fc.assert(fc.property(state, guards, (s, g) => {
      const tr = next(s, g);
      if (tr === undefined) {
        expect(TRANSITIONS.filter((x) => x.from === s).some((x) => g[x.guard])).toBe(false);
        return;
      }
      expect(tr.from).toBe(s);
      expect(g[tr.guard]).toBe(true);
      expect(STATES).toContain(tr.to);
      expect(TRANSITIONS).toContain(tr);
      // the first matching entry of the table wins
      expect(TRANSITIONS.find((x) => x.from === s && g[x.guard])).toBe(tr);
    }), { numRuns: 1000 });
  });

  it('always leads lost and ikFail to idle', () => {
    fc.assert(fc.property(guards, (g) => {
      for (const s of ['approach', 'descend'] as StateId[]) if (g.ikFail) expect(next(s, g)?.to).toBe('idle');
      for (const s of ['grasp', 'lift', 'transfer'] as StateId[]) if (g.lost) expect(next(s, g)?.to).toBe('idle');
    }), { numRuns: 500 });
  });

  it('reaches every state from idle, and has the nominal chain', () => {
    const seen = new Set<StateId>(['idle']);
    const queue: StateId[] = ['idle'];
    while (queue.length > 0) {
      const s = queue.shift()!;
      for (const tr of TRANSITIONS) if (tr.from === s && !seen.has(tr.to)) { seen.add(tr.to); queue.push(tr.to); }
    }
    expect([...seen].sort()).toEqual([...STATES].sort());
    const chain: StateId[] = ['idle', 'approach', 'descend', 'grasp', 'lift', 'transfer', 'release', 'homing', 'idle'];
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(TRANSITIONS.some((tr) => tr.from === chain[i] && tr.to === chain[i + 1] && !['ikFail', 'lost'].includes(tr.guard)), `${chain[i]} -> ${chain[i + 1]}`).toBe(true);
    }
  });

  it('is the only source of transitions: every entry names a state and a guard of the Guards record', () => {
    const keys = Object.keys(makeGuards());
    for (const tr of TRANSITIONS) {
      expect(STATES).toContain(tr.from); expect(STATES).toContain(tr.to); expect(keys).toContain(tr.guard);
    }
  });
});
