import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioSpace } from './contract.js';
import { shrink, type ShrinkRunner } from './shrink.js';

const space: ScenarioSpace = {
  dims: [
    { name: 'force', kind: 'force', min: 0, max: 200, severity: 'up' },
    { name: 'angle', kind: 'angle', min: 0, max: 360, severity: 'none', wrap: true },
    { name: 'speed', kind: 'speed', min: 0, max: 2, severity: 'down' },
    { name: 'dur', kind: 'duration', min: 0.2, max: 0.2, severity: 'none' },
  ],
};
const limits = { tolerance: 0.01, maxTrials: 60 };
const asRunner = (fn: (s: Scenario) => number, log: Scenario[] = []): ShrinkRunner => (s) => {
  log.push(s);
  return Promise.resolve({ robustness: fn(s) });
};
const start = { force: 190, angle: 135, speed: 0.3, dur: 0.2 };

describe('shrink', () => {
  it('finds the mildest failing force within the tolerance on a half-space', async () => {
    // fails when force > 100
    const out = await shrink({ scenario: start, seed: 1, robustness: -90 }, space,
      asRunner((s) => 100 - (s['force'] as number) + 0 * (s['speed'] as number)), limits);
    expect(out.scenario['force']).toBeGreaterThan(100);
    expect(out.scenario['force']).toBeLessThanOrEqual(100 + 0.01 * 200 + 1e-9);
    expect(out.shrunk).toBe(true);
    expect(out.scenario['angle']).toBe(135);
    expect(out.scenario['dur']).toBe(0.2);
  });
  it('accepts the milder end at once when it already fails', async () => {
    const log: Scenario[] = [];
    const out = await shrink({ scenario: start, seed: 1, robustness: -1 }, space, asRunner(() => -1, log), limits);
    expect(out.scenario['force']).toBe(0);
    expect(out.scenario['speed']).toBe(2); // milder end of a 'down' dimension is max
    expect(log).toHaveLength(2);
  });
  it('returns the input unchanged and runs no trial when already at the milder ends', async () => {
    let calls = 0;
    const s = { force: 0, angle: 10, speed: 2, dur: 0.2 };
    const out = await shrink({ scenario: s, seed: 1, robustness: -1 }, space, () => { calls++; return null; }, limits);
    expect(calls).toBe(0);
    expect(out.scenario).toEqual(s);
    expect(out.shrunk).toBe(false);
  });
  it('handles a non-monotone failing set and still returns a failing scenario', async () => {
    // fails only for force in [150, 200] or [20, 40]
    const fn = (s: Scenario) => {
      const f = s['force'] as number;
      return (f >= 150 || (f >= 20 && f <= 40)) ? -1 : 1;
    };
    const out = await shrink({ scenario: { ...start, force: 180 }, seed: 1, robustness: -1 }, space, asRunner(fn), limits);
    expect(fn(out.scenario)).toBeLessThan(0);
    expect(out.scenario['force']).toBeLessThanOrEqual(180);
  });
  it('returns the mildest failing scenario so far when the budget is gone mid-shrink', async () => {
    let n = 0;
    const runner: ShrinkRunner = (s) => (++n > 3 ? null : Promise.resolve({ robustness: (s['force'] as number) > 50 ? -1 : 1 }));
    const out = await shrink({ scenario: start, seed: 1, robustness: -1 }, space, runner, limits);
    expect(out.budgetStopped).toBe(true);
    expect(out.trials).toHaveLength(3);
    expect(out.scenario['force']).toBeLessThanOrEqual(190);
  });
  it('treats an errored candidate as not failing and keeps going', async () => {
    const runner: ShrinkRunner = (s) =>
      Promise.resolve((s['force'] as number) === 0 ? { error: 'boom' } : { robustness: (s['force'] as number) > 100 ? -1 : 1 });
    const out = await shrink({ scenario: start, seed: 1, robustness: -1 }, space, runner, limits);
    // golem-falsify-hardening defect 7: speed changes after force, so force gets a second pass and its
    // milder end (the erroring candidate) is tried once per pass.
    expect(out.errors).toEqual(['boom', 'boom']);
    expect(out.trials.filter((t) => t.error !== undefined).map((t) => t.scenario['force'])).toEqual([0, 0]);
    expect(out.scenario['force']).toBeGreaterThan(100);
  });
  it('treats a NaN candidate as not failing and logs it', async () => {
    const out = await shrink({ scenario: { ...start, speed: 2 }, seed: 1, robustness: -1 }, space,
      asRunner((s) => ((s['force'] as number) === 0 ? NaN : (s['force'] as number) > 100 ? -1 : 1)), limits);
    expect(out.errors.some((e) => /NaN/.test(e))).toBe(true);
  });
  it('stops at the global trial limit', async () => {
    const out = await shrink({ scenario: start, seed: 1, robustness: -1 }, space,
      asRunner((s) => ((s['force'] as number) > 100 ? -1 : 1)), { tolerance: 1e-6, maxTrials: 4 });
    expect(out.trials).toHaveLength(4);
  });
  it('never moves a wrap severity dimension across the seam', async () => {
    const wrapSpace: ScenarioSpace = { dims: [{ name: 'phase', kind: 'phase', min: 0, max: 1, severity: 'up', wrap: true }] };
    const seen: number[] = [];
    const out = await shrink({ scenario: { phase: 0.9 }, seed: 1, robustness: -1 }, wrapSpace,
      asRunner((s) => { seen.push(s['phase'] as number); return (s['phase'] as number) > 0.5 ? -1 : 1; }), limits);
    for (const v of seen) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(0.9); }
    expect(out.scenario['phase']).toBeGreaterThan(0.5);
  });
});
