import { describe, expect, it } from 'vitest';
import { liveHandleCount } from './handles.js';
import { miniApp, miniReq, miniSpec } from './test-fixtures.js';
import { validateTrial } from './validate.js';

const run = (a = miniApp(), r = miniReq(), s = miniSpec()) => validateTrial(a, r, s);

describe('validateTrial', () => {
  it('accepts a valid spec and resolves step counts and calls', () => {
    const v = run();
    expect(v.n).toBe(10);
    expect(v.warmupControlSteps).toBe(10);
    expect(v.warmupSimSteps).toBe(100);
    expect(v.controlSteps).toBe(50);
    expect(v.calls).toHaveLength(1);
    expect(v.calls[0]!.values).toEqual({ force: 100, duration: 0.2, angle: 1 });
  });
  it('rejects an app id mismatch naming both ids', () => {
    expect(() => run(miniApp(), miniReq(), miniSpec({ app: 'other' }))).toThrow(/"other".*"mini"/);
  });
  it('rejects a controlDt that is not a multiple of simDt', () => {
    expect(() => run(miniApp({ controlDt: 0.0205 }))).toThrow(/controlDt.*simDt/);
  });
  it('rejects a non-positive simDt', () => {
    expect(() => run(miniApp({ simDt: 0 }))).toThrow(/simDt/);
  });
  it('rejects a warm-up that is not a multiple of controlDt, naming seconds', () => {
    expect(() => run(miniApp({ warmup: 0.21 }))).toThrow(/warmup \(0\.21 s\)/);
  });
  it('rejects a negative warm-up', () => {
    expect(() => run(miniApp({ warmup: -0.02 }))).toThrow(/warmup/);
  });
  it.each([0, -1, NaN, Infinity])('rejects horizon %s', (h) => {
    expect(() => run(miniApp(), miniReq({ horizon: h }))).toThrow(/horizon/);
  });
  it.each([-1, 1.5, 4294967296, NaN])('rejects seed %s', (seed) => {
    expect(() => run(miniApp(), miniReq(), miniSpec({ seed }))).toThrow(/Seed/);
  });
  it('names every missing dimension', () => {
    expect(() => run(miniApp(), miniReq(), miniSpec({ scenario: {} }))).toThrow(/push\.force, push\.angle/);
  });
  it('rejects a non-finite value', () => {
    expect(() => run(miniApp(), miniReq(), miniSpec({ scenario: { 'push.force': NaN, 'push.angle': 0 } }))).toThrow(/push\.force/);
  });
  it('rejects an out-of-range value naming dimension and SI range', () => {
    expect(() => run(miniApp(), miniReq(), miniSpec({ scenario: { 'push.force': 250, 'push.angle': 0 } })))
      .toThrow('push.force = 250 N is outside [0 N, 200 N]');
  });
  it('wraps an angle outside its range', () => {
    const v = run(miniApp(), miniReq(), miniSpec({ scenario: { 'push.force': 1, 'push.angle': -Math.PI / 2 } }));
    expect(v.scenario['push.angle']).toBeCloseTo(1.5 * Math.PI, 12);
  });
  it('rejects an unknown template', () => {
    expect(() => run(miniApp(), miniReq({ perturbations: [{ template: 'kick', params: {} }] }))).toThrow(/"kick"/);
  });
  it('rejects a param naming an unknown dimension', () => {
    expect(() => run(miniApp(), miniReq({ perturbations: [{ template: 'push', params: { force: 'nope' } }] }))).toThrow(/"nope"/);
  });
  it('matches a template by phrase when it has no name', () => {
    const app = miniApp();
    delete app.lexicon.perturbations[0]!.name;
    expect(run(app, miniReq({ perturbations: [{ template: 'push', params: {} }] })).calls).toHaveLength(1);
  });
  it('touches no handle', () => {
    const before = liveHandleCount();
    expect(() => run(miniApp(), miniReq(), miniSpec({ seed: -1 }))).toThrow();
    run();
    expect(liveHandleCount()).toBe(before);
  });
});

