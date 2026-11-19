import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioSpace } from './contract.js';
import { shrink, type ShrinkRunner } from './shrink.js';

// golem-falsify-hardening defect 7: coarse sweep before bisecting, and a second pass.
const limits = { tolerance: 0.01, maxTrials: 60 };
const runner = (fn: (s: Scenario) => number, log: Scenario[] = []): ShrinkRunner => (s) => {
  log.push(s);
  return Promise.resolve({ robustness: fn(s) });
};
const forceOnly: ScenarioSpace = { dims: [{ name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' }] };

describe('shrink: sweep and second pass', () => {
  it('finds a failing window that plain bisection jumps over', async () => {
    // fails for force in (130, 165) or above 200; bisection from 240 tests 120, 180, 210 and lands at 200
    const fn = (s: Scenario) => {
      const f = s['force'] as number;
      return Math.min(Math.max(130 - f, f - 165), 200 - f);
    };
    const out = await shrink({ scenario: { force: 240 }, seed: 1, robustness: fn({ force: 240 }) }, forceOnly, runner(fn), limits);
    expect(fn(out.scenario)).toBeLessThan(0);
    expect(out.scenario['force']).toBeGreaterThan(130);
    expect(out.scenario['force']).toBeLessThanOrEqual(132.5);
  });

  it('revisits a dimension after a later dimension changed', async () => {
    // fails when force > 150, or when force > 50 and mass < 20 (mass harsher upwards, but light is worse)
    const sp: ScenarioSpace = {
      dims: [
        { name: 'force', kind: 'force', min: 0, max: 250, severity: 'up' },
        { name: 'mass', kind: 'mass', min: 0, max: 100, severity: 'up' },
      ],
    };
    const fn = (s: Scenario) => {
      const f = s['force'] as number;
      const m = s['mass'] as number;
      return Math.min(150 - f, Math.max(50 - f, m - 20));
    };
    const start = { force: 200, mass: 100 };
    const out = await shrink({ scenario: start, seed: 1, robustness: fn(start) }, sp, runner(fn), limits);
    expect(fn(out.scenario)).toBeLessThan(0);
    expect(out.scenario['mass']).toBe(0);
    expect(out.scenario['force']).toBeGreaterThan(50);
    expect(out.scenario['force']).toBeLessThanOrEqual(52.5);
  });

  it('runs no second pass for a single severity dimension', async () => {
    const log: Scenario[] = [];
    const fn = (s: Scenario) => 100 - (s['force'] as number);
    await shrink({ scenario: { force: 240 }, seed: 1, robustness: -140 }, forceOnly, runner(fn, log), limits);
    expect(log.filter((s) => s['force'] === 0)).toHaveLength(1);
  });
});
