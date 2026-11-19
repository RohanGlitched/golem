import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStream, mulberry32 } from '../core/prng.js';
import { TEXT_PAIRS, TOKENS, contrastRatio } from '../core/theme-tokens.js';
import { frameToTRS, nlerp, quatRotateWXYZ, writeMatrixTRS } from '../core/pose-math.js';
import { FixedStepAccumulator } from '../core/accumulator.js';
import { KEY_PUSH_FORCE, keyPushDirection, keyPushSteps, rayPlane, shovePlaneNormal, springForce } from '../core/spring.js';
import { RenderScheduler } from '../core/scheduler.js';
import { tweenValue } from '../core/tween.js';
import { Announcer } from '../core/announcer.js';
import { decimalsOf, roundTo } from '../core/format.js';
import { fromDisplay, toDisplay } from '../core/units-ui.js';
import { FakeRaf } from './fakes.js';
import type { Reason } from '../types.js';

const R = { numRuns: 100 };
const num = (lim: number) => fc.double({ min: -lim, max: lim, noNaN: true, noDefaultInfinity: true });

describe('core properties', () => {
  // Feature: golem-studio-ui, Property 48: Seeded determinism
  it('derives the same stream per label and finds no Math.random in src/ui', () => {
    fc.assert(fc.property(fc.integer(), fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (seed, a, b) => {
      const s1 = deriveStream(seed, a), s2 = deriveStream(seed, a);
      const x = [s1(), s1(), s1()], y = [s2(), s2(), s2()];
      expect(x).toEqual(y);
      if (a !== b) { const o = deriveStream(seed, b); expect([o(), o(), o()]).not.toEqual(x); }
      const m = mulberry32(seed); const v = m(); expect(v >= 0 && v < 1).toBe(true);
    }), R);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const bad: string[] = [];
    const needle = new RegExp('Math' + '\\.random\\s*\\(');
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && needle.test(fs.readFileSync(p, 'utf8'))) bad.push(p);
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });

  // Feature: golem-studio-ui, Property 44: Theme tokens and contrast
  it('meets the contrast minimum for every text pair in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const p of TEXT_PAIRS) {
        expect(contrastRatio(TOKENS[theme][p.fg], TOKENS[theme][p.bg])).toBeGreaterThanOrEqual(p.min);
      }
    }
    const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => '#' + n.toString(16).padStart(6, '0'));
    fc.assert(fc.property(hex, hex, (a, b) => {
      const c = contrastRatio(a, b);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeCloseTo(contrastRatio(b, a), 10);
    }), R);
  });

  // Feature: golem-studio-ui, Property 34: Display unit conversion round trip
  it('converts display units to SI and back within 1e-12', () => {
    const units = ['N', 'kN', 's', 'ms', 'm', 'cm', 'mm', 'm/s', 'cm/s', 'deg', 'rad', 'kg', 'g', '%'];
    fc.assert(fc.property(fc.constantFrom(...units), fc.double({ min: 1e-6, max: 1e6, noNaN: true }), (u, v) => {
      const back = toDisplay(fromDisplay(v, u), u);
      expect(Math.abs(back - v) / v).toBeLessThan(1e-12);
    }), R);
  });

  // Feature: golem-studio-ui, Property 4: Pose conversion matches the quaternion definition
  it('builds matrices equal to the quaternion rotation plus position', () => {
    const quat = fc.tuple(num(1), num(1), num(1), num(1)).filter((q) => Math.hypot(...q) > 0.1);
    fc.assert(fc.property(quat, fc.tuple(num(5), num(5), num(5)), fc.tuple(num(3), num(3), num(3)), (q, p, v) => {
      const n = Math.hypot(...q);
      const [qw, qx, qy, qz] = q.map((c) => c / n) as [number, number, number, number];
      const frames = new Float32Array([p[0], p[1], p[2], qw, qx, qy, qz]);
      const o = new Float64Array(7);
      frameToTRS(frames, 1, 0, 0, o);
      expect(o[0]).toBeCloseTo(frames[0]!, 6);
      expect(o[3]).toBe(frames[4]); expect(o[6]).toBe(frames[3]);
      const m = new Float64Array(16);
      writeMatrixTRS(m, 0, o[0]!, o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!);
      const r = new Float64Array(3);
      quatRotateWXYZ(frames[3]!, frames[4]!, frames[5]!, frames[6]!, v[0], v[1], v[2], r);
      for (let i = 0; i < 3; i++) {
        const mv = m[i]! * v[0] + m[4 + i]! * v[1] + m[8 + i]! * v[2] + m[12 + i]!;
        expect(Math.abs(mv - (r[i]! + o[i]!))).toBeLessThan(1e-4);
      }
    }), R);
  });

  it('keeps nlerp quaternions at unit length and positions between frames', () => {
    const q = fc.tuple(num(1), num(1), num(1), num(1)).filter((x) => Math.hypot(...x) > 0.1);
    fc.assert(fc.property(q, q, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, al) => {
      const na = Math.hypot(...a), nb = Math.hypot(...b);
      const f = new Float32Array([0, 1, 2, ...a.map((c) => c / na), 4, 5, 6, ...b.map((c) => c / nb)]);
      const out = new Float64Array(7);
      nlerp(f, 1, 0, 1, 0, al, out);
      expect(Math.hypot(out[3]!, out[4]!, out[5]!, out[6]!)).toBeCloseTo(1, 6);
      expect(out[0]!).toBeGreaterThanOrEqual(-1e-9); expect(out[0]!).toBeLessThanOrEqual(4 + 1e-9);
    }), R);
  });

  // Feature: golem-studio-ui, Property 6: Fixed-step decoupling
  it('keeps the remainder under dt and the step total within one of floor(T/dt)', () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), { minLength: 1, maxLength: 60 }),
      fc.double({ min: 0.001, max: 0.02, noNaN: true }), (frames, dt) => {
        const a = new FixedStepAccumulator(dt, 1e9);
        let steps = 0, T = 0;
        for (const f of frames) {
          steps += a.add(f); T += f;
          expect(a.acc).toBeGreaterThanOrEqual(0); expect(a.acc).toBeLessThan(dt + 1e-12);
        }
        expect(Math.abs(steps - Math.floor(T / dt))).toBeLessThanOrEqual(1);
      }), R);
    fc.assert(fc.property(fc.double({ min: 1, max: 50, noNaN: true }), fc.integer({ min: 1, max: 20 }), (big, cap) => {
      const dt = 0.01; const a = new FixedStepAccumulator(dt, cap);
      expect(a.add(big)).toBe(cap);
      expect(a.acc).toBeGreaterThanOrEqual(0); expect(a.acc).toBeLessThan(dt + 1e-12);
      a.resumeAfterHidden(); expect(a.add(0)).toBe(0);
    }), R);
  });

  // Feature: golem-studio-ui, Property 8: Spring force
  it('points the spring force at the target with magnitude min(k d, 400)', () => {
    const v = fc.tuple(num(3), num(3), num(3));
    fc.assert(fc.property(v, v, fc.double({ min: 1, max: 2000, noNaN: true }), (G, P, k) => {
      const f = springForce(G, P, k);
      const d: [number, number, number] = [P[0] - G[0], P[1] - G[1], P[2] - G[2]];
      const dn = Math.hypot(...d), fn = Math.hypot(...f);
      expect(fn).toBeCloseTo(Math.min(k * dn, 400), 6);
      if (dn > 1e-9 && fn > 0) expect((f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) / (fn * dn)).toBeCloseTo(1, 6);
    }), R);
    expect(springForce([1, 2, 3], [1, 2, 3], 600)).toEqual([0, 0, 0]);
  });

  // Feature: golem-studio-ui, Property 9: Ray and Shove_Plane intersection
  it('returns a point on the plane and on the ray, or nothing', () => {
    const v = fc.tuple(num(5), num(5), num(5));
    fc.assert(fc.property(v, v, v, v, (O, d, G, cam) => {
      const n = shovePlaneNormal(cam);
      if (!n) return;
      const P = rayPlane(O, d, G, n);
      const nd = n[0] * d[0] + n[1] * d[1];
      if (!P) return;
      expect(Math.abs(n[0] * (P[0] - G[0]) + n[1] * (P[1] - G[1]))).toBeLessThan(1e-6 * (1 + Math.abs(G[0]) + Math.abs(P[0]) + Math.abs(P[1])));
      const t = (n[0] * (G[0] - O[0]) + n[1] * (G[1] - O[1])) / nd;
      expect(t).toBeGreaterThanOrEqual(0);
    }), R);
  });

  // Feature: golem-studio-ui, Property 10: Key push direction and magnitude
  it('rotates the key push with the camera and keeps zero vertical component', () => {
    fc.assert(fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), fc.double({ min: 0.002, max: 0.01, noNaN: true }), (az, th, dt) => {
      const cam = (a: number): [number, number, number] => [Math.cos(a) * 0.8, Math.sin(a) * 0.8, -0.5];
      const up = keyPushDirection('ArrowUp', cam(az))!, down = keyPushDirection('ArrowDown', cam(az))!;
      const right = keyPushDirection('ArrowRight', cam(az))!, left = keyPushDirection('ArrowLeft', cam(az))!;
      expect(up[2]).toBe(0);
      expect(Math.hypot(up[0], up[1]) * KEY_PUSH_FORCE).toBeCloseTo(100, 8);
      expect(up[0] + down[0]).toBeCloseTo(0, 9); expect(right[1] + left[1]).toBeCloseTo(0, 9);
      expect(up[0] * right[0] + up[1] * right[1]).toBeCloseTo(0, 9);
      const rot = keyPushDirection('ArrowUp', cam(az + th))!;
      const ex = [up[0] * Math.cos(th) - up[1] * Math.sin(th), up[0] * Math.sin(th) + up[1] * Math.cos(th)];
      expect(rot[0]).toBeCloseTo(ex[0]!, 8); expect(rot[1]).toBeCloseTo(ex[1]!, 8);
      expect(keyPushSteps(dt)).toBe(Math.round(0.2 / dt));
    }), R);
  });

  // Feature: golem-studio-ui, Property 11: Render scheduler draws no idle frames
  it('never keeps more than one frame pending and draws no idle frames', () => {
    const reasons: Reason[] = ['simulating', 'dragging', 'replaying', 'ghosts-running', 'transition'];
    const op = fc.oneof(
      fc.record({ k: fc.constant('acq' as const), r: fc.constantFrom(...reasons) }),
      fc.record({ k: fc.constant('rel' as const), r: fc.constantFrom(...reasons) }),
      fc.record({ k: fc.constant('once' as const) }),
      fc.record({ k: fc.constant('vis' as const), v: fc.boolean() }),
      fc.record({ k: fc.constant('run' as const) }),
    );
    fc.assert(fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
      const raf = new FakeRaf();
      let drawn = 0, visible = true, dirty = false;
      const held = new Set<Reason>();
      const s = new RenderScheduler(raf, () => { drawn++; });
      for (const o of ops) {
        const before = drawn;
        if (o.k === 'acq') { s.acquire(o.r); held.add(o.r); }
        else if (o.k === 'rel') { s.release(o.r); if (held.delete(o.r) && held.size === 0) dirty = true; }
        else if (o.k === 'once') { s.requestOnce(); dirty = true; }
        else if (o.k === 'vis') { s.setVisible(o.v); visible = o.v; if (o.v) { expect(raf.pending === 1).toBe(held.size > 0 || dirty); } }
        else if (raf.runNext()) { dirty = false; expect(drawn).toBe(before + 1); expect(visible).toBe(true); if (held.size === 0) expect(raf.pending).toBe(0); }
        expect(raf.pending).toBeLessThanOrEqual(1);
        if (!visible) expect(raf.pending).toBe(0);
        if (visible && held.size > 0) expect(raf.pending).toBe(1);
      }
      for (let i = 0; i < 3 && raf.runNext(); i++) { /* drain */ }
      if (held.size === 0 && visible) expect(raf.pending).toBe(0);
    }), R);
  });

  // Feature: golem-studio-ui, Property 43: Number tween bounds
  it('keeps tweens inside their end points and exact at both ends', () => {
    fc.assert(fc.property(num(1e6), num(1e6), fc.double({ min: -1, max: 2, noNaN: true }), (from, to, p) => {
      const v = tweenValue(from, to, p);
      expect(v).toBeGreaterThanOrEqual(Math.min(from, to)); expect(v).toBeLessThanOrEqual(Math.max(from, to));
      expect(tweenValue(from, to, 0)).toBe(from); expect(tweenValue(from, to, 1)).toBe(to);
      const p2 = Math.min(1, Math.max(0, p)); const w = tweenValue(from, to, Math.min(1, p2 + 0.1));
      expect(Math.abs(to - w)).toBeLessThanOrEqual(Math.abs(to - tweenValue(from, to, p2)) + 1e-9);
    }), R);
  });

  // Feature: golem-studio-ui, Property 47: Announcement rate limit
  it('emits progress at least 2000 ms apart and finals always', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 1500 }), { maxLength: 60 }), (gaps) => {
      const els = { polite: { textContent: '' as string | null }, alert: { textContent: '' as string | null } };
      const a = new Announcer(els);
      let t = 0; let last = -Infinity;
      for (const g of gaps) {
        t += g;
        if (a.announceProgress('p', t)) { expect(t - last).toBeGreaterThanOrEqual(2000); last = t; }
      }
      a.announceFinal('verdict'); expect(els.polite.textContent).toContain('verdict');
    }), R);
  });

  it('rounds without binary noise', () => {
    fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), fc.integer({ min: 0, max: 6 }), (n, d) => {
      const x = n / 10 ** d;
      expect(decimalsOf(roundTo(x + 1e-13, d))).toBeLessThanOrEqual(d);
    }), R);
  });
});
