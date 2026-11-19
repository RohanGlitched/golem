import { describe, expect, it } from 'vitest';
import { SimError, wrapTrialError } from './errors.js';
import { PHYSICS_RUNS, PURE_RUNS, SEED, describeTrial, reportFailure } from './test-support.js';

const app = { id: 'test' };
const req = { id: 'R2' };

describe('wrapTrialError', () => {
  it('puts app id, requirement id and decimal seed in the message', () => {
    const e = wrapTrialError(new Error('boom'), app, req, { seed: 4000000000 });
    expect(e.message).toBe('Trial failed (app test, requirement R2, seed 4000000000): boom');
  });
  it('keeps the original error as cause', () => {
    const cause = new Error('inner');
    expect(wrapTrialError(cause, app, req, { seed: 1 }).cause).toBe(cause);
  });
  it('contains no stack text', () => {
    const e = wrapTrialError(new Error('boom'), app, req, { seed: 1 });
    expect(e.message).not.toMatch(/\n\s+at /);
  });
  it('does not wrap an already identified error twice', () => {
    const once = wrapTrialError(new SimError('x'), app, req, { seed: 1 });
    expect(wrapTrialError(once, app, req, { seed: 1 })).toBe(once);
  });
  it('wraps a plain SimError that has no trial identity yet', () => {
    const inner = new SimError('x');
    const e = wrapTrialError(inner, app, req, { seed: 1 });
    expect(e).not.toBe(inner);
    expect(e.cause).toBe(inner);
  });
  it('accepts non-Error throwables', () => {
    expect(wrapTrialError('oops', app, req, { seed: 1 }).message).toContain('oops');
  });
});

describe('test support', () => {
  it('exposes the run counts and a seed', () => {
    expect(PHYSICS_RUNS).toBeGreaterThanOrEqual(25);
    expect(PURE_RUNS).toBeGreaterThanOrEqual(100);
    expect(Number.isInteger(SEED)).toBe(true);
  });
  it('failure reporter prints app id, requirement id, scenario and seed', async () => {
    const spec = { app: 'test', reqId: 'R1', scenario: { f: 1 }, seed: 7 };
    await expect(reportFailure(spec, () => { throw new Error('bad'); })).rejects.toThrow(describeTrial(spec));
  });
});
