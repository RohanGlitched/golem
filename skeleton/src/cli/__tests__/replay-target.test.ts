import { describe, expect, it } from 'vitest';
import { selectReplay } from '../replay-target.js';
import type { Counterexample } from '../sibling-types.js';

const ce = (seed: number, f: number): Counterexample => ({ reqId: 'R1', scenario: { 'push.force': f }, seed, robustness: -0.1, shrunk: true, foundAfter: 3 });
const pinned = [ce(1, 100), ce(2, 150), ce(3, 120)];
const closest = { scenario: { 'push.force': 90 }, seed: 9 };

describe('selectReplay (CLI)', () => {
  it('takes the last pinned entry', () => {
    expect(selectReplay(pinned, closest, { cli: true })).toEqual({ ok: true, source: 'pinned', scenario: { 'push.force': 120 }, seed: 3 });
  });

  it('with --seed keeps the scenario of the last pinned entry', () => {
    expect(selectReplay(pinned, closest, { cli: true, seed: 77 })).toEqual({ ok: true, source: 'pinned', scenario: { 'push.force': 120 }, seed: 77 });
  });

  it('with --seed and nothing pinned falls back to the closest scenario', () => {
    expect(selectReplay([], closest, { cli: true, seed: 5 })).toEqual({ ok: true, source: 'closest', scenario: { 'push.force': 90 }, seed: 5 });
  });

  it('reports none-pinned without --seed, or without closest', () => {
    expect(selectReplay([], closest, { cli: true })).toMatchObject({ ok: false, reason: 'none-pinned' });
    expect(selectReplay([], undefined, { cli: true, seed: 5 })).toMatchObject({ ok: false, reason: 'none-pinned' });
  });
});

describe('selectReplay (MCP)', () => {
  it('takes the latest pinned entry without a seed', () => {
    expect(selectReplay(pinned, undefined, { cli: false })).toMatchObject({ ok: true, seed: 3 });
  });

  it('takes exactly the entry whose seed matches', () => {
    expect(selectReplay(pinned, undefined, { cli: false, seed: 2 })).toEqual({ ok: true, source: 'pinned', scenario: { 'push.force': 150 }, seed: 2 });
  });

  it('lists the pinned seeds when the seed is unknown', () => {
    expect(selectReplay(pinned, closest, { cli: false, seed: 42 })).toEqual({ ok: false, reason: 'seed-not-pinned', pinnedSeeds: [1, 2, 3] });
  });

  it('says none is pinned when the list is empty', () => {
    expect(selectReplay([], closest, { cli: false, seed: 1 })).toMatchObject({ ok: false, reason: 'none-pinned', pinnedSeeds: [] });
  });
});
