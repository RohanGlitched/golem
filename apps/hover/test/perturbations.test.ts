import fc from 'fast-check';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { HOVER_NAMES, MAX_LAG, MIN_BATTERY } from '../constants';
import { batterySags, estimateLags, gustAndLag, gustForce, gustHits, perturbations, sagBattery } from '../perturbations';
import { runtimeFor } from '../runtime';
import { compileRobot } from './helpers/mujoco';

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

function fresh() {
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, HOVER_NAMES as never);
  return { data, ctx, rt: runtimeFor(ctx) };
}
const thrustGears = (): number[] => Array.from({ length: 4 }, (_, a) => model.actuator_gear[6 * a + 2] as number);

describe('gust direction', () => {
  it('has the magnitude of the force, for any direction', () => {
    fc.assert(fc.property(num(0, 50), num(-10, 10), (f, angle) => {
      const out = new Float64Array(2);
      gustForce(f, angle, out);
      expect(Math.hypot(out[0]!, out[1]!)).toBeCloseTo(f, 9);
    }), { numRuns: 200 });
  });
  it('comes from the side named by the angle, counterclockwise from +x, and pushes away from it (the G1 push.angle convention)', () => {
    const out = new Float64Array(2);
    gustForce(10, 0, out);                       // from +x: pushes toward -x
    expect(out[0]).toBeCloseTo(-10, 12); expect(Math.abs(out[1]!)).toBeLessThan(1e-12);
    gustForce(10, Math.PI / 2, out);             // from +y: pushes toward -y
    expect(Math.abs(out[0]!)).toBeLessThan(1e-9); expect(out[1]).toBeCloseTo(-10, 12);
    gustForce(10, Math.PI, out);                 // from -x
    expect(out[0]).toBeCloseTo(10, 12);
  });
  it('is the same for a direction and the same direction plus a full turn', () => {
    fc.assert(fc.property(num(0, 30), num(0, 6.28), (f, a) => {
      const p = new Float64Array(2), q = new Float64Array(2);
      gustForce(f, a, p); gustForce(f, a + 2 * Math.PI, q);
      expect(q[0]).toBeCloseTo(p[0]!, 9); expect(q[1]).toBeCloseTo(p[1]!, 9);
    }), { numRuns: 100 });
  });
});

describe('gust apply', () => {
  const values = { force: 7, direction: 0.8, duration: 0.5 };
  it('pushes the body horizontally, and only while the gust lasts', () => {
    const { data, ctx, rt } = fresh();
    try {
      const row = rt.bodyRow;
      const expected = new Float64Array(2); gustForce(7, 0.8, expected);
      for (const [t, on] of [[1.9, false], [2.0, true], [2.25, true], [2.4999, true], [2.5, false], [3, false]] as const) {
        rt.xfrc.fill(0);
        gustHits.apply(ctx, t, 2.0, values);
        if (on) {
          expect(rt.xfrc[row]).toBeCloseTo(expected[0]!, 12); expect(rt.xfrc[row + 1]).toBeCloseTo(expected[1]!, 12);
        } else {
          expect(Array.from(rt.xfrc.slice(row, row + 6))).toEqual([0, 0, 0, 0, 0, 0]);
        }
        expect(rt.xfrc[row + 2]).toBe(0);
      }
    } finally { data.delete(); }
  });
  it('writes the gust of the combined phrase the same way', () => {
    const { data, ctx, rt } = fresh();
    try {
      gustAndLag.apply(ctx, 2.1, 2.0, values);
      expect(Math.hypot(rt.xfrc[rt.bodyRow]!, rt.xfrc[rt.bodyRow + 1]!)).toBeCloseTo(7, 9);
    } finally { data.delete(); }
  });
  it('hints the arrow for the studio: the force vector at the body', () => {
    const v = gustHits.visual!(values);
    expect(v.at).toBe('x2');
    expect(Math.hypot(v.force![0], v.force![1])).toBeCloseTo(7, 9);
    expect(v.force![2]).toBe(0);
  });
});

describe('battery sag', () => {
  it('scales the thrust and the yaw reaction of every motor, and the model snapshot can bring it back', () => {
    const before = Array.from(model.actuator_gear as Float64Array);
    const { data, ctx } = fresh();
    try {
      sagBattery(ctx, 0.6);
      for (let a = 0; a < 4; a++) {
        expect(model.actuator_gear[6 * a + 2]).toBeCloseTo(0.6 * before[6 * a + 2]!, 12);
        expect(model.actuator_gear[6 * a + 5]).toBeCloseTo(0.6 * before[6 * a + 5]!, 12);
        expect(model.actuator_gear[6 * a]).toBe(before[6 * a]);          // no other component moves
      }
    } finally {
      model.actuator_gear.set(before);
      data.delete();
    }
    expect(Array.from(model.actuator_gear as Float64Array)).toEqual(before);
  });
  it('limits the ratio to [MIN_BATTERY, 1]', () => {
    const before = Array.from(model.actuator_gear as Float64Array);
    const { data, ctx } = fresh();
    try {
      fc.assert(fc.property(num(-5, 5), (ratio) => {
        model.actuator_gear.set(before);
        sagBattery(ctx, ratio);
        const k = (thrustGears()[0] as number) / before[2]!;
        expect(k).toBeGreaterThanOrEqual(MIN_BATTERY - 1e-12);
        expect(k).toBeLessThanOrEqual(1 + 1e-12);
      }), { numRuns: 100 });
      model.actuator_gear.set(before);
      sagBattery(ctx, Number.NaN);
      expect(thrustGears()[0]).toBeCloseTo(MIN_BATTERY * before[2]!, 12);
    } finally { model.actuator_gear.set(before); data.delete(); }
  });
  it('acts in begin, through the template', () => {
    const before = Array.from(model.actuator_gear as Float64Array);
    const { data, ctx } = fresh();
    try {
      batterySags.begin!(ctx, { ratio: 0.75 });
      expect(thrustGears()[1]).toBeCloseTo(0.75 * before[6 + 2]!, 12);
    } finally { model.actuator_gear.set(before); data.delete(); }
  });
});

describe('estimate lag', () => {
  it('sets the lag of the trial in begin, limited to [0, MAX_LAG], for both lag phrases', () => {
    const { data, ctx, rt } = fresh();
    try {
      estimateLags.begin!(ctx, { duration: 0.2 });
      expect(rt.lag).toBe(0.2);
      gustAndLag.begin!(ctx, { force: 3, direction: 1, duration: 0.5, duration2: 0.3 });
      expect(rt.lag).toBe(0.3);
      fc.assert(fc.property(num(-5, 5), (lag) => {
        estimateLags.begin!(ctx, { duration: lag });
        expect(rt.lag).toBeGreaterThanOrEqual(0);
        expect(rt.lag).toBeLessThanOrEqual(MAX_LAG);
      }), { numRuns: 100 });
    } finally { data.delete(); }
  });
  it('keeps the lag of one trial out of another', () => {
    const a = fresh(), b = fresh();
    try {
      estimateLags.begin!(a.ctx, { duration: 0.4 });
      expect(a.rt.lag).toBe(0.4);
      expect(b.rt.lag).toBe(0);
    } finally { a.data.delete(); b.data.delete(); }
  });
});

describe('the template list', () => {
  it('has four templates with distinct phrases, each with an apply', () => {
    expect(new Set(perturbations.map((p) => p.phrase)).size).toBe(4);
    for (const p of perturbations) expect(typeof p.apply).toBe('function');
  });
  it('declares a dimension and a severity for every searched slot', () => {
    expect(gustHits.slots).toEqual({ force: { dim: 'gust.force', severity: 'up' }, direction: { dim: 'gust.angle', severity: 'none' } });
    expect(batterySags.slots!['ratio']).toEqual({ dim: 'battery.ratio', severity: 'down' });
    expect(estimateLags.slots!['duration']).toEqual({ dim: 'estimate.lag', severity: 'up' });
    expect(gustAndLag.slots!['duration2']).toEqual({ dim: 'estimate.lag', severity: 'up' });
  });
});
