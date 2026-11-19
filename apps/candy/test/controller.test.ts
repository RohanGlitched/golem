import { afterAll, describe, expect, it } from 'vitest';
import { HAND_START, Q_HOME, T_READY, UD } from '../constants';
import { commandSpeed } from '../controller';
import { gcCount } from './helpers/alloc';
import { makeSim } from './helpers/sim';

const sim = await makeSim();
afterAll(() => { sim.dispose(); });
const { data, controller, mj, model } = sim;

describe('CandyController', () => {
  it('holds the Home_Pose before T_READY = 1.3 s with the switch off', () => {
    sim.run(T_READY - 0.1);
    expect(sim.t).toBeCloseTo(T_READY - 0.1, 9);
    expect(controller.state).toBe('idle');
    expect(Array.from(controller.qTarget)).toEqual(Array.from(Q_HOME));
    expect(data.userdata[UD.switch]).toBe(0);
    for (let j = 0; j < 7; j++) expect(Math.abs(data.qpos[j] - Q_HOME[j]!)).toBeLessThan(0.01);
  });

  it('starts picking after T_READY: idle, then approach with a candy chosen', () => {
    sim.run(0.2);
    expect(controller.state).toBe('approach');
    expect(controller.candy).toBeGreaterThanOrEqual(0);
  });

  it('stops when the hand is not finite: targets and the suction switch stay as they are', () => {
    const before = Float64Array.from(controller.qTarget);
    const sw = data.userdata[UD.switch];
    data.mocap_pos[0] = NaN;
    sim.run(0.3);
    expect(controller.lastScale).toBe(0);
    expect(Array.from(controller.qTarget)).toEqual(Array.from(before));
    expect(data.userdata[UD.switch]).toBe(sw);
    data.mocap_pos[0] = HAND_START.x;
    sim.run(0.2);
    expect(controller.lastScale).toBe(1);
    expect(Array.from(controller.qTarget)).not.toEqual(Array.from(before));
  });

  it('allocates nothing in step and substep', async () => {
    const t = 2.0;
    const n = await gcCount(3000, () => { controller.step(sim.ctx, t); controller.substep(sim.ctx, t); });
    expect(n).toBe(0);
  });

  it('deletes its handles once: dispose twice does not throw', () => {
    // a second controller on the same model, disposed twice
    const other = new (controller.constructor as any)(sim.ctx, () => 0.5);
    other.dispose();
    expect(() => other.dispose()).not.toThrow();
  });

  it('draws no random number: the PRNG it is given is never called', () => {
    let calls = 0;
    const other = new (controller.constructor as any)(sim.ctx, () => { calls++; return 0.5; });
    other.step(sim.ctx, 2.0);
    other.dispose();
    expect(calls).toBe(0);
  });

  it('reports a clamped vacuum ratio once through warnings()', () => {
    expect(controller.warnings()).toEqual([]);
    data.userdata[UD.vacuum] = 1.7;
    data.userdata[UD.switch] = 1;
    controller.substep(sim.ctx, 0);
    expect(controller.warnings()).toEqual(['Vacuum_Ratio 1.7 is outside [0, 1]; using 1']);
    controller.substep(sim.ctx, 0);
    expect(controller.warnings()).toEqual([]);
    data.userdata[UD.vacuum] = 1; data.userdata[UD.switch] = 0;
  });
});

describe('commandSpeed', () => {
  it('rises by at most 2.5 m/s² and drops at once', () => {
    expect(commandSpeed(0.5, 1, 0, 0.02, 2.5)).toBeCloseTo(0.05, 12);
    expect(commandSpeed(0.5, 1, 0.5, 0.02, 2.5)).toBe(0.5);
    expect(commandSpeed(0.5, 0.2, 0.5, 0.02, 2.5)).toBeCloseTo(0.1, 12);
    expect(commandSpeed(0.5, 0, 0.5, 0.02, 2.5)).toBe(0);
  });
  it('reaches the nominal speed 0.5 m/s in 0.2 s from rest', () => {
    let v = 0, t = 0;
    while (v < 0.5 && t < 1) { v = commandSpeed(0.5, 1, v, 0.02, 2.5); t += 0.02; }
    // ten steps of 0.05 m/s; a rounding error in the running sum can cost one more step
    expect(t).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(t).toBeLessThanOrEqual(0.22 + 1e-9);
  });
});

void mj; void model;
