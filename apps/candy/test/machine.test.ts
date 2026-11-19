import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATES, TRANSITIONS, makeGuards, next, suctionOn, type Guards, type StateId } from '../controller/machine';

const SRC = readFileSync(new URL('../controller/machine.ts', import.meta.url), 'utf8');

/** Drives the machine with one guard at a time, in the order the nominal cycle needs them. */
describe('machine', () => {
  it('visits idle, approach, descend, grasp, lift, transfer, release, homing, idle in one nominal cycle', () => {
    const script: (keyof Guards)[] = ['candidate', 'atAbove', 'nearCandy', 'dwellDone', 'lifted', 'atBowl', 'dwellDone', 'homeReached'];
    let s: StateId = 'idle';
    const visited: StateId[] = [s];
    for (const g of script) {
      const guards = makeGuards();
      guards[g] = true;
      const tr = next(s, guards);
      expect(tr, `${s} + ${g}`).toBeDefined();
      s = tr!.to;
      visited.push(s);
    }
    expect(visited).toEqual(['idle', 'approach', 'descend', 'grasp', 'lift', 'transfer', 'release', 'homing', 'idle']);
  });

  it('sends ikFail from approach and descend, and lost from grasp, lift and transfer, to idle', () => {
    for (const s of ['approach', 'descend'] as StateId[]) {
      const g = makeGuards(); g.ikFail = true; g.atAbove = true; g.nearCandy = true;
      expect(next(s, g)).toMatchObject({ to: 'idle', action: 'skipCandy' });
    }
    for (const s of ['grasp', 'lift', 'transfer'] as StateId[]) {
      const g = makeGuards(); g.lost = true; g.dwellDone = true; g.lifted = true; g.atBowl = true;
      expect(next(s, g)).toMatchObject({ to: 'idle', action: 'switchOff' });
    }
  });

  it('switches suction on at the grasp and off at the release, and keeps it on from grasp to transfer', () => {
    const on = TRANSITIONS.filter((tr) => tr.action === 'switchOn');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ from: 'descend', to: 'grasp' });
    expect(TRANSITIONS.find((tr) => tr.action === 'release')).toMatchObject({ from: 'transfer', to: 'release' });
    expect(STATES.filter(suctionOn)).toEqual(['grasp', 'lift', 'transfer']);
  });

  it('holds the state when no guard is true', () => {
    for (const s of STATES) expect(next(s, makeGuards())).toBeUndefined();
  });

  it('uses frozen data', () => {
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(STATES)).toBe(true);
    for (const tr of TRANSITIONS) expect(Object.isFrozen(tr)).toBe(true);
  });

  it('reads no wall clock and draws no random number', () => {
    expect(SRC).not.toMatch(/Date\.now|performance\.now|Math\.random|new Date/);
  });
});
