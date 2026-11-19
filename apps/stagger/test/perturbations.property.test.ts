import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gaitPhase } from '../controller/observation';
import { friction, payload, push, pushForce, pushStartOffset, slopeGravity, validateRatio } from '../perturbations';
import { runtimeFor } from '../runtime';
import { stubModelCtx } from './helpers/stubModel';

const d = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const unitHeading = d(-Math.PI, Math.PI).map((a) => Float64Array.from([Math.cos(a), Math.sin(a)]));
const angDiff = (a: number, b: number) => { let x = (a - b) % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; return Math.abs(x); };

describe('Feature: stagger-app, Property 24: Push force magnitude and window', () => {
  it('has norm push.force inside [start, start + duration) and is exactly zero outside, never vertical', () => {
    fc.assert(fc.property(d(0, 500), d(0, 2 * Math.PI), d(0, 10), d(0.01, 1), unitHeading, d(-1, 12), (f, a, start, dur, h, t) => {
      const out = Float64Array.from([7, 7, 7]);
      pushForce(t, start, dur, f, h, a, out);
      expect(out[2]).toBe(0);
      const n = Math.hypot(out[0]!, out[1]!);
      if (t >= start && t < start + dur) expect(Math.abs(n - f)).toBeLessThanOrEqual(1e-9 * Math.max(1, f));
      else { expect(out[0]).toBe(0); expect(out[1]).toBe(0); }
    }), { numRuns: 300 });
  });
  it('writes no torque and no vertical force into xfrc_applied', () => {
    fc.assert(fc.property(d(0, 500), d(0, 2 * Math.PI), d(0, 1), (f, a, ph) => {
      const { ctx } = stubModelCtx();
      const values = { force: f, duration: 0.2, angle: a, phase: ph };
      for (let k = 0; k < 600; k++) {
        const t = 2 + k * 0.002;
        ctx.data.xfrc_applied.fill(0);
        push.apply(ctx, t, 2, values);
        const r = ctx.data.xfrc_applied.subarray(6, 12);
        expect([r[2], r[3], r[4], r[5]]).toEqual([0, 0, 0, 0]);
        expect(Array.from(ctx.data.xfrc_applied.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
      }
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 25: Push direction follows the latched Heading', () => {
  it('points away from the side the push comes from: the Heading rotated by push.angle + 180 deg', () => {
    fc.assert(fc.property(d(1, 500), d(0, 2 * Math.PI), unitHeading, (f, a, h) => {
      const out = new Float64Array(3);
      pushForce(0.1, 0, 0.2, f, h, a, out);
      expect(angDiff(Math.atan2(out[1]!, out[0]!), Math.atan2(h[1]!, h[0]!) + a + Math.PI)).toBeLessThanOrEqual(1e-9);
    }), { numRuns: 300 });
  });
  it('keeps the direction latched at the trigger when the pelvis turns later', () => {
    fc.assert(fc.property(d(-Math.PI, Math.PI), d(-Math.PI, Math.PI), d(0, 2 * Math.PI), (yaw0, yaw1, a) => {
      const { ctx } = stubModelCtx({ yaw: yaw0 });
      const values = { force: 100, duration: 0.2, angle: a, phase: gaitPhase(2) };
      push.apply(ctx, 2, 2, values);
      // turn the pelvis after the trigger
      ctx.data.xquat[4] = Math.cos(yaw1 / 2); ctx.data.xquat[7] = Math.sin(yaw1 / 2);
      ctx.data.xfrc_applied.fill(0);
      push.apply(ctx, 2.1, 2, values);
      const fx = ctx.data.xfrc_applied[6]!, fy = ctx.data.xfrc_applied[7]!;
      expect(Math.hypot(fx, fy)).toBeCloseTo(100, 9);
      expect(angDiff(Math.atan2(fy, fx), yaw0 + a + Math.PI)).toBeLessThanOrEqual(1e-9);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 26: Push start offset hits the requested gait phase', () => {
  it('lies in [0, 0.8) s and reaches push.phase', () => {
    fc.assert(fc.property(d(0, 0.999999), d(0, 50), (p, tTrig) => {
      const off = pushStartOffset(p, gaitPhase(tTrig));
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(0.8);
      const got = gaitPhase(tTrig + off);
      const diff = Math.abs(got - p);
      expect(Math.min(diff, 1 - diff)).toBeLessThanOrEqual(1e-9);
    }), { numRuns: 300 });
  });
});

describe('Feature: stagger-app, Property 27: Slope keeps the gravity norm', () => {
  it('keeps the norm and the y component for slopes from 0 to 20 deg', () => {
    fc.assert(fc.property(d(0, (20 * Math.PI) / 180), d(-1, 1), d(-1, 1), d(-12, -1), (a, gx, gy, gz) => {
      const out = new Float64Array(3);
      slopeGravity([gx, gy, gz], a, out);
      const n0 = Math.hypot(gx, gy, gz);
      expect(Math.abs(Math.hypot(out[0]!, out[1]!, out[2]!) - n0)).toBeLessThanOrEqual(1e-12 * n0);
      expect(out[1]).toBe(gy);
    }), { numRuns: 300 });
  });
});

describe('Feature: stagger-app, Property 28: Payload adds mass exactly', () => {
  it('makes the torso mass the original plus the payload', () => {
    fc.assert(fc.property(d(0, 30), d(1, 40), (add, m0) => {
      const { ctx, setConstCalls } = stubModelCtx({ mass: m0 });
      payload.apply(ctx, 2, 2, { mass: add });
      expect(Math.abs(ctx.model.body_mass[1]! - (m0 + add))).toBeLessThanOrEqual(1e-12 * (m0 + add));
      expect(runtimeFor(ctx).saved.torsoMass).toBe(m0);
      if (add > 0) expect(setConstCalls()).toBe(1);
      // later calls change nothing more
      payload.apply(ctx, 2.002, 2, { mass: add });
      expect(Math.abs(ctx.model.body_mass[1]! - (m0 + add))).toBeLessThanOrEqual(1e-12 * (m0 + add));
    }), { numRuns: 200 });
  });
});

describe('Feature: stagger-app, Property 29: Friction ratio scales sliding friction and out-of-range ratios are rejected', () => {
  it('sets the sliding friction to ratio times the original and keeps the other coefficients', () => {
    fc.assert(fc.property(d(0, 1), d(0.1, 2), (r, mu) => {
      const { ctx } = stubModelCtx();
      ctx.model.geom_friction[0] = mu;
      friction.apply(ctx, 2, 2, { ratio: r });
      friction.apply(ctx, 2.002, 2, { ratio: r });
      expect(ctx.model.geom_friction[0]).toBe(mu * r);
      expect(ctx.model.geom_friction[1]).toBe(0.005);
      expect(ctx.model.geom_friction[2]).toBe(0.0001);
    }), { numRuns: 200 });
  });
  it('rejects every ratio below 0 or above 1 with the ratio and the range', () => {
    const outside = fc.oneof(d(-100, -1e-9), d(1 + 1e-9, 100));
    fc.assert(fc.property(outside, (r) => {
      expect(() => validateRatio(r)).toThrow(/^ratio -?[0-9.e+-]+% is outside 0% to 100%$/);
    }), { numRuns: 200 });
  });
});
