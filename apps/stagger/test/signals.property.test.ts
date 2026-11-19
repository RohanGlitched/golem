import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MovingAverage, forwardSpeed, heading, lateralDrift, tiltDeg } from '../signals';

const finite = (lim: number) => fc.double({ min: -lim, max: lim, noNaN: true, noDefaultInfinity: true });
const unitQuat = fc.tuple(finite(1), finite(1), finite(1), finite(1))
  .filter(([w, x, y, z]) => w * w + x * x + y * y + z * z > 1e-3)
  .map(([w, x, y, z]) => { const n = Math.hypot(w, x, y, z); return [w / n, x / n, y / n, z / n]; });
const relClose = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

describe('Feature: stagger-app, Property 18: Moving average semantics', () => {
  it('equals the mean of the last min(n, 50) samples and lies between their extremes', () => {
    fc.assert(fc.property(fc.array(finite(100), { minLength: 1, maxLength: 200 }), (xs) => {
      const m = new MovingAverage(50);
      for (const x of xs) m.push(x);
      const last = xs.slice(-50);
      const mean = last.reduce((s, x) => s + x, 0) / last.length;
      const got = m.mean();
      expect(relClose(got, mean, 1e-12)).toBe(true);
      expect(got).toBeGreaterThanOrEqual(Math.min(...last) - 1e-12);
      expect(got).toBeLessThanOrEqual(Math.max(...last) + 1e-12);
    }), { numRuns: 200 });
  });
  it('equals a constant velocity once 50 samples exist', () => {
    fc.assert(fc.property(finite(10), fc.integer({ min: 50, max: 300 }), (v, n) => {
      const m = new MovingAverage(50);
      for (let i = 0; i < n; i++) m.push(v);
      expect(Math.abs(m.mean() - v)).toBeLessThanOrEqual(1e-12);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 19: forward_speed is invariant under a common yaw rotation', () => {
  it('keeps the projected speed when the velocity and the heading rotate together', () => {
    fc.assert(fc.property(finite(5), finite(5), finite(Math.PI), finite(Math.PI), (vx, vy, a, yaw) => {
      const h = new Float64Array(2);
      heading([Math.cos(a / 2), 0, 0, Math.sin(a / 2)], h);
      const before = forwardSpeed(vx, vy, h[0]!, h[1]!);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const h2 = new Float64Array(2);
      // rotate the pelvis quaternion by yaw about world z: q' = qz(yaw) * q
      const hw = Math.cos(yaw / 2), hz = Math.sin(yaw / 2), qw = Math.cos(a / 2), qz = Math.sin(a / 2);
      heading([hw * qw - hz * qz, 0, 0, hw * qz + hz * qw], h2);
      const after = forwardSpeed(c * vx - s * vy, s * vx + c * vy, h2[0]!, h2[1]!);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.hypot(vx, vy)));
    }), { numRuns: 200 });
  });
});

describe('Feature: stagger-app, Property 20: Tilt range and lateral drift geometry', () => {
  it('keeps tilt in [0, 180] deg and gives 0 for any pure yaw', () => {
    fc.assert(fc.property(unitQuat, finite(Math.PI), (q, yaw) => {
      const t = tiltDeg(q);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(180);
      expect(tiltDeg([Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)])).toBeLessThanOrEqual(1e-6);
    }), { numRuns: 200 });
  });
  it('equals the perpendicular horizontal distance to the heading line', () => {
    fc.assert(fc.property(finite(10), finite(10), finite(10), finite(10), finite(Math.PI), finite(10), (p0x, p0y, along, side, a, _z) => {
      const hx = Math.cos(a), hy = Math.sin(a);
      // a point `along` metres down the line and `side` metres off it
      const px = p0x + along * hx - side * hy;
      const py = p0y + along * hy + side * hx;
      const d = lateralDrift(px, py, p0x, p0y, hx, hy);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Math.abs(d - Math.abs(side))).toBeLessThanOrEqual(1e-9);
    }), { numRuns: 200 });
  });
});
