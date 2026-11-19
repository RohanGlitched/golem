// Feature: candy-app, Property 20: Commanded speed follows the scale, and a non-finite hand stops the arm
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { CTRL, HAND_START, UD } from '../constants';
import { commandSpeed } from '../controller';
import { makeSim } from './helpers/sim';

describe('commanded speed', () => {
  it('is at most vNom * scale, at most vPrev + aUp * dt, never negative, and 0 for scale 0', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 2, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 3, noNaN: true }), fc.double({ min: 0.001, max: 0.1, noNaN: true }),
      (vNom, scale, vPrev, dt) => {
        const v = commandSpeed(vNom, scale, vPrev, dt, CTRL.aUp);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(vNom * scale + 1e-12);
        expect(v).toBeLessThanOrEqual(vPrev + CTRL.aUp * dt + 1e-12);
        expect(commandSpeed(vNom, 0, vPrev, dt, CTRL.aUp)).toBe(0);
        // either of the two caps is reached
        expect(Math.abs(v - Math.min(vNom * scale, vPrev + CTRL.aUp * dt))).toBeLessThan(1e-12);
      },
    ), { numRuns: 500 });
  });
});

describe('controller stop rule', () => {
  it('holds the joint targets and the suction switch when the scale is 0, and when the hand is not finite', async () => {
    const sim = await makeSim();
    try {
      sim.run(1.6);          // past T_READY, approaching a candy
      const { data, controller } = sim;
      const tipId = controller.ids.tipSite;
      const mocap = data.mocap_pos as Float64Array;
      const hand = fc.oneof(
        // within 0.15 m of the tip: scale 0
        fc.tuple(fc.double({ min: -0.1, max: 0.1, noNaN: true }), fc.double({ min: -0.1, max: 0.1, noNaN: true }), fc.double({ min: -0.1, max: 0.1, noNaN: true }), fc.constant(false)),
        // anywhere, but one coordinate is not finite
        fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.constant(true)),
      );
      fc.assert(fc.property(hand, fc.integer({ min: 0, max: 2 }), fc.constantFrom(NaN, Infinity, -Infinity), fc.constantFrom(0, 1), (h, k, bad, sw) => {
        sim.mj.mj_kinematics(sim.model, data);
        const tip = Array.from(data.site_xpos.slice(3 * tipId, 3 * tipId + 3) as Float64Array);
        const target = tip.map((v, i) => v + (h[i] as number));
        if (h[3]) target[k] = bad;
        mocap[0] = target[0]!; mocap[1] = target[1]!; mocap[2] = target[2]!;
        data.userdata[UD.switch] = sw;
        const before = Float64Array.from(controller.qTarget);
        const state = controller.state;
        const dwell = controller.dwell;
        for (let i = 0; i < 3; i++) controller.step(sim.ctx, 2.0 + 0.02 * i);
        expect(controller.lastScale).toBe(0);
        expect(Array.from(controller.qTarget)).toEqual(Array.from(before));
        expect(data.userdata[UD.switch]).toBe(sw);
        expect(controller.state).toBe(state);
        expect(controller.dwell).toBe(dwell);
        expect(controller.vPrev).toBe(0);
        // put the hand back
        mocap[0] = HAND_START.x; mocap[1] = HAND_START.y; mocap[2] = HAND_START.z;
      }), { numRuns: 60 });
    } finally { sim.dispose(); }
  });
});

afterAll(() => undefined);
