import { describe, expect, it } from 'vitest';
import { BudgetClock, validateBudget, type BudgetConfig } from './budget.js';

const cfg = (over: Partial<BudgetConfig> = {}): BudgetConfig => ({
  phase1Fraction: 0.4, phase2Fraction: 0.6, randomOnly: false, reserveFraction: 0.15, reserveMin: 12, ...over,
});

describe('validateBudget', () => {
  it('rejects a Budget with neither limit and names both fields', () => {
    expect(() => validateBudget({}, 0.4, 0.6)).toThrow(/maxTrials.*maxWallMs/);
  });
  it('rejects a non-integer maxTrials and names the value', () => {
    expect(() => validateBudget({ maxTrials: 10.5 }, 0.4, 0.6)).toThrow(/maxTrials.*10\.5/);
  });
  it('rejects zero, negative and non-finite limits', () => {
    expect(() => validateBudget({ maxTrials: 0 }, 0.4, 0.6)).toThrow(/maxTrials/);
    expect(() => validateBudget({ maxWallMs: -1 }, 0.4, 0.6)).toThrow(/maxWallMs.*-1/);
    expect(() => validateBudget({ maxWallMs: Infinity }, 0.4, 0.6)).toThrow(/maxWallMs/);
    expect(() => validateBudget({ maxTrials: NaN }, 0.4, 0.6)).toThrow(/maxTrials/);
  });
  it('rejects fractions outside [0, 1] and sums above 1, naming both fractions and the sum', () => {
    expect(() => validateBudget({ maxTrials: 5 }, -0.1, 0.5)).toThrow(/phase1Fraction/);
    expect(() => validateBudget({ maxTrials: 5 }, 0.5, 1.5)).toThrow(/phase2Fraction/);
    expect(() => validateBudget({ maxTrials: 5 }, 0.7, 0.5)).toThrow(/0\.7.*0\.5.*1\.2/);
  });
  it('accepts either limit alone or both', () => {
    expect(() => validateBudget({ maxTrials: 5 }, 0.4, 0.6)).not.toThrow();
    expect(() => validateBudget({ maxWallMs: 5 }, 0.4, 0.6)).not.toThrow();
    expect(() => validateBudget({ maxTrials: 5, maxWallMs: 5 }, 1, 0)).not.toThrow();
  });
});

describe('BudgetClock', () => {
  it('splits 100 trials 40/60 by default', () => {
    const b = new BudgetClock({ maxTrials: 100 }, cfg());
    expect(b.grant(1, 1000)).toBe(40);
    b.record(1, 40);
    expect(b.grant(2, 1000)).toBe(60);
  });
  it('carries unused Phase 1 budget into Phase 2 and nothing out of Phase 2', () => {
    const b = new BudgetClock({ maxTrials: 100 }, cfg());
    b.record(1, 10);
    expect(b.grant(2, 1000)).toBe(90);
    b.record(2, 50);
    expect(b.grant(2, 1000)).toBe(40);
    b.record(2, 40);
    expect(b.grant(2, 5)).toBe(0);
    expect(b.trialsExhausted()).toBe(true);
    expect(b.grant(1, 5)).toBe(0);
  });
  it('counts Phase 0 against the total', () => {
    const b = new BudgetClock({ maxTrials: 100 }, cfg());
    b.record(0, 5);
    expect(b.grant(1, 1000)).toBe(40);
    b.record(1, 40);
    expect(b.grant(2, 1000)).toBe(55);
  });
  it('shrinks the last generation to the grant', () => {
    const b = new BudgetClock({ maxTrials: 10 }, cfg({ phase1Fraction: 1, phase2Fraction: 0 }));
    b.record(1, 8);
    expect(b.grant(1, 32)).toBe(2);
  });
  it('gives random-only mode the whole remaining budget in Phase 1', () => {
    const b = new BudgetClock({ maxTrials: 50 }, cfg({ randomOnly: true }));
    b.record(0, 3);
    expect(b.grant(1, 1000)).toBe(47);
  });
  it('reserves max(12, 15%) shrink trials on top of the search budget', () => {
    expect(new BudgetClock({ maxTrials: 40 }, cfg()).shrinkReserve).toBe(12);
    expect(new BudgetClock({ maxTrials: 200 }, cfg()).shrinkReserve).toBe(30);
    expect(new BudgetClock({ maxWallMs: 1000 }, cfg()).shrinkReserve).toBeNull();
    const b = new BudgetClock({ maxTrials: 40 }, cfg());
    b.record(1, 40);
    expect(b.trialsExhausted()).toBe(true);
    for (let i = 0; i < 12; i++) { expect(b.grantShrink()).toBe(1); b.recordShrink(1); }
    expect(b.grantShrink()).toBe(0);
  });
  it('keeps n0 + n1 + n2 within the trial limit', () => {
    const b = new BudgetClock({ maxTrials: 37 }, cfg());
    let total = 0;
    for (const p of [0, 1, 2] as const) {
      for (let g = b.grant(p, 7); g > 0; g = b.grant(p, 7)) { b.record(p, g); total += g; }
    }
    expect(total).toBeLessThanOrEqual(37);
  });
  it('stops granting when the wall limit is reached (injected clock)', () => {
    let t = 0;
    const b = new BudgetClock({ maxWallMs: 1000 }, cfg(), () => t);
    b.start();
    expect(b.grant(1, 10)).toBe(10);
    t = 399; expect(b.grant(1, 10)).toBe(10);
    t = 400; expect(b.grant(1, 10)).toBe(0);
    expect(b.grant(2, 10)).toBe(10);
    t = 1000; expect(b.grant(2, 10)).toBe(0);
    t = 1100; expect(b.grantShrink()).toBe(1); // wall reserve of 15%
    t = 1150; expect(b.grantShrink()).toBe(0);
  });
  it('grants only the whole waves that fit before the deadline once a wave was measured', () => {
    let t = 0;
    const b = new BudgetClock({ maxWallMs: 1000 }, cfg(), () => t);
    b.start();
    expect(b.waveMs()).toBeNull();
    expect(b.grant(1, 64, 4)).toBe(64); // no estimate yet
    b.observe(8, 20, 4); // 2 waves of 10 ms
    expect(b.waveMs()).toBe(10);
    t = 350; // 50 ms left in Phase 1: 5 waves of 4
    expect(b.grant(1, 64, 4)).toBe(20);
    expect(b.lastGrantTimeLimited).toBe(true);
    expect(b.grant(1, 8, 4)).toBe(8);
    expect(b.lastGrantTimeLimited).toBe(false);
    b.observe(4, 30, 4); // average of 10 and 30
    expect(b.waveMs()).toBe(20);
    t = 1140; // 10 ms left of the 15% shrink reserve: less than one wave
    expect(b.grantShrink()).toBe(0);
  });
  it('never uses the wave estimate without a wall limit', () => {
    const b = new BudgetClock({ maxTrials: 100 }, cfg(), () => { throw new Error('clock read'); });
    b.observe(4, 1e9, 1);
    expect(b.waveMs()).toBeNull();
    expect(b.grant(1, 32, 1)).toBe(32);
  });
});
