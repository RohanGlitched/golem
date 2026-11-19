import { describe, expect, it } from 'vitest';
import { DIVERGED_ROBUSTNESS } from '../../sim/index.js';
import {
  counterexampleSummary, isFall, lineStatusOf, marginText, predicatesOf, replayLabel, statusOfVerdict, statusText,
} from '../run/status.js';
import { seedFromJson, seedToJson } from '../run/seed-json.js';
import { PINS_MEMORY_TEXT, PinnedSeedStore, pinKey, sameCounterexample } from '../run/pins.js';
import {
  UNREADABLE, buildShareState, decodeShare, encodeShare, fitShare, ignoredText, shareFragment, tooLongText,
} from '../run/share-hash.js';
import { heldSentence, verdictRows } from '../verdict/verdict-rows.js';
import { FakeStorage } from './fakes.js';
import type { Counterexample, ScenarioSpace, Verdict } from '../types.js';

const space: ScenarioSpace = {
  dims: [
    { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' },
    { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
    { name: 'gait.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
    { name: 'push.duration', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};
const ce: Counterexample = {
  reqId: '2.1', scenario: { 'push.force': 168, 'push.angle': (135 * Math.PI) / 180 }, seed: 7,
  robustness: -0.04, shrunk: true, foundAfter: 37,
};
const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  reqId: '2.1', status: 'held', trials: 480, randomTrials: 400, guidedTrials: 80,
  closest: { robustness: 0.1234, scenario: {}, seed: 1 }, ms: 12345, ...over,
});

describe('status', () => {
  it('summarises a fall as "falls from 168 N at 135 deg, 62% into the stride"', () => {
    const s = counterexampleSummary(space, { 'push.force': 168, 'push.angle': (135 * Math.PI) / 180, 'gait.phase': 0.62, 'push.duration': 0.2 }, undefined, undefined, true);
    expect(s).toBe('falls from 168 N at 135 deg, 62% into the stride');
  });
  it('adds "depends on the seed" for a seed-sensitive counterexample', () => {
    expect(counterexampleSummary(space, { 'push.force': 168 }, 'seed-sensitive')).toBe('fails from 168 N, depends on the seed');
  });
  it('picks "falls" and "Replay the fall" only for a height or tilt predicate', () => {
    const lex = {
      predicates: [
        { phrase: 'stay upright', signals: ['pelvis.height'], unit: 'm', margin: () => 0 },
        { phrase: 'track the speed', signals: ['base.vx'], unit: 'm/s', margin: () => 0 },
      ],
    };
    const fall = predicatesOf('WHEN x THE robot SHALL stay upright for 3 s', lex);
    expect(isFall(fall)).toBe(true);
    expect(replayLabel(isFall(fall))).toBe('Replay the fall');
    expect(isFall(predicatesOf('THE robot SHALL track the speed', lex))).toBe(false);
    expect(replayLabel(false)).toBe('Replay the failure');
  });
  it('maps verdicts and compile errors to the line status in order', () => {
    expect(statusOfVerdict({ status: 'broken' })).toBe('broken');
    expect(lineStatusOf({ hasCompileError: true, running: true })).toBe('error');
    expect(lineStatusOf({ hasCompileError: false, running: true, verdict: verdict() })).toBe('running');
    expect(lineStatusOf({ hasCompileError: false, running: false, verdict: verdict() })).toBe('held');
    expect(lineStatusOf({ hasCompileError: false, running: false })).toBe('untested');
  });
  it('writes margins with three significant figures and "diverged" for -Infinity', () => {
    expect(marginText(0.1234, 'm')).toBe('0.123 m');
    expect(marginText(0.000123, 'm')).toBe('0.000123 m');
    expect(marginText(-Infinity, 'm')).toBe('diverged');
  });
  it('writes "diverged" for the sim sentinel of a numerically diverged trial, not its magnitude', () => {
    expect(marginText(DIVERGED_ROBUSTNESS, 'm')).toBe('diverged');
    expect(marginText(-1e300, 'm')).not.toBe('diverged');
  });
  it('states held lines as no counterexample found, never proved or verified', () => {
    const t = statusText({ status: 'held', verdict: verdict(), unit: 'm' });
    expect(t).toBe('Held: no counterexample found in 480 trials, closest call 0.123 m');
    expect(t).not.toMatch(/proved|verified/i);
    expect(statusText({ status: 'untested' })).toBe('Not tested yet');
    expect(statusText({ status: 'running', trials: 37 })).toBe('Running: 37 trials');
  });
});

describe('seed JSON', () => {
  it('writes 2-space JSON with the stable key order', () => {
    const j = seedToJson({ ...ce, scenario: { b: 1, a: 2 } });
    expect(j.split('\n')[1]).toBe('  "reqId": "2.1",');
    expect(Object.keys(JSON.parse(j))).toEqual(['reqId', 'scenario', 'seed', 'robustness', 'shrunk', 'foundAfter']);
    expect(Object.keys(JSON.parse(j).scenario)).toEqual(['a', 'b']);
  });
  it('round trips a -Infinity robustness', () => {
    const r = seedFromJson(seedToJson({ ...ce, robustness: -Infinity }));
    expect(r.ok && r.value.robustness).toBe(-Infinity);
  });
  it('gives an error message for invalid JSON', () => {
    const r = seedFromJson('{nope');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^The seed is not valid JSON/);
  });
});

describe('PinnedSeedStore', () => {
  it('keeps pins in memory and announces once when storage is missing', () => {
    const said: string[] = [];
    const p = new PinnedSeedStore(undefined, (m) => said.push(m));
    expect(p.pin('stagger', ce)).toBe('memory-only');
    expect(p.pin('stagger', { ...ce, seed: 8 })).toBe('memory-only');
    expect(p.read('stagger', '2.1')).toHaveLength(2);
    expect(said).toEqual([PINS_MEMORY_TEXT]);
  });
  it('falls back to memory when storage is full', () => {
    const st = new FakeStorage(); st.failWrites = true;
    const said: string[] = [];
    const p = new PinnedSeedStore(st, (m) => said.push(m));
    expect(p.pin('a', ce)).toBe('memory-only');
    expect(p.read('a', '2.1')).toEqual([ce]);
    expect(said).toEqual([PINS_MEMORY_TEXT]);
  });
  it('ignores invalid JSON with one warning', () => {
    const st = new FakeStorage(); st.setItem(pinKey('a', '2.1'), '{bad');
    const said: string[] = [];
    expect(new PinnedSeedStore(st, (m) => said.push(m)).read('a', '2.1')).toEqual([]);
    expect(said).toHaveLength(1);
  });
  it('keeps the valid entries mixed with invalid ones and states the count ignored', () => {
    const st = new FakeStorage();
    st.setItem(pinKey('a', '2.1'), `[${seedToJson(ce)}, {"reqId": 3}, 5]`);
    const said: string[] = [];
    expect(new PinnedSeedStore(st, (m) => said.push(m)).read('a', '2.1')).toEqual([ce]);
    expect(said).toEqual(['Ignored 2 invalid pinned seeds for 2.1']);
  });
  it('stores an equal counterexample once and removes it', () => {
    const st = new FakeStorage();
    const p = new PinnedSeedStore(st, () => {});
    expect(p.pin('a', ce)).toBe('added');
    expect(p.pin('a', { ...ce, robustness: -9, shrunk: false })).toBe('duplicate');
    expect(sameCounterexample(ce, { ...ce, scenario: { ...ce.scenario, x: 1 } })).toBe(false);
    p.remove('a', ce);
    expect(p.read('a', '2.1')).toEqual([]);
  });
});

describe('share hash', () => {
  const known = new Set(['1.1', '2.1']);
  it('loads the original with a message for a malformed hash', () => {
    const r = decodeShare('#g=@@@', known);
    expect(r.state).toEqual({ lines: {} });
    expect(ignoredText(r.ignored)).toBe(`Ignored the shared link: ${UNREADABLE}`);
  });
  it('ignores an unknown id while valid ids apply', () => {
    const h = shareFragment({ lines: { '1.1': 'WHEN x THE robot SHALL y', '9.9': 'z' } });
    const r = decodeShare(h, known);
    expect(r.state.lines).toEqual({ '1.1': 'WHEN x THE robot SHALL y' });
    expect(r.ignored).toEqual(['line 9.9, which is not in this file']);
  });
  it('round trips non-ASCII text and a pick', () => {
    const s = { lines: { '2.1': 'WHEN pushed with 200 N → THE robot SHALL ✓ “stay”' }, pick: { reqId: '2.1', seed: 12345, scenario: { 'push.force': 168 } } };
    expect(decodeShare('#g=' + encodeShare(s), known)).toEqual({ state: s, ignored: [] });
  });
  it('keeps only edited lines', () => {
    expect(buildShareState({ '1.1': 'a', '2.1': 'b' }, { '1.1': 'a', '2.1': 'c' })).toEqual({ lines: { '2.1': 'c' } });
  });
  it('drops edited lines from the end and says the link is too long', () => {
    const original = { '1.1': 'a', '2.1': 'b', '3.2': 'c', '3.4': 'd' };
    const big = 'x'.repeat(1400);
    const r = fitShare({ lines: { '1.1': big, '2.1': big, '3.2': big, '3.4': big } }, original);
    expect(r.hash.length).toBeLessThanOrEqual(4000);
    expect(r.tooLong).toBe(true);
    expect(r.omittedIds).toEqual(['3.2', '3.4']);
    expect(tooLongText(r.omittedIds)).toBe('The link is too long: it leaves out edits to lines 3.2 and 3.4');
  });
});

describe('verdict rows', () => {
  it('formats the held sentence with the budget', () => {
    expect(heldSentence(verdict(), { maxTrials: 240, maxMs: 30000 }))
      .toBe('No counterexample found in 480 trials (400 random, 80 guided). Search budget: 240 trials or 30 s.');
  });
  it('shows "not available" for a missing failure-rate bound', () => {
    const r = verdictRows(verdict(), 4, 'm', {});
    expect(r.rows.find((x) => x.label === 'Failure-rate bound (95%)')!.value).toBe('not available');
    expect(r.rows.find((x) => x.label === 'Wall time')!.value).toBe('12.3 s');
    expect(r.rows.find((x) => x.label === 'Pool size')!.value).toBe('4');
    expect(verdictRows(verdict({ failureRateUpper95: 0.006234 }), 4, 'm', {}).rows[4]!.value).toBe('0.62%');
  });
});
