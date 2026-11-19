import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { filmstripFrames } from '../reel/filmstrip.js';
import { ReplayController } from '../reel/replay.js';
import { synthPoses } from './fakes.js';

const R = { numRuns: 100 };

describe('reel properties', () => {
  // Feature: golem-studio-ui, Property 45: Filmstrip frame selection
  it('selects eight ordered frames inside the recording with one worst frame', () => {
    fc.assert(fc.property(fc.double({ min: -2, max: 12, noNaN: true }), fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 120 }), (w, n, fps) => {
      const f = filmstripFrames(w, n, fps);
      const T = (n - 1) / fps;
      expect(f).toHaveLength(8);
      for (let k = 0; k < 8; k++) {
        const e = f[k]!;
        expect(e.tau).toBeGreaterThanOrEqual(0);
        expect(e.tau).toBeLessThanOrEqual(T);
        expect(e.frame).toBeGreaterThanOrEqual(0);
        expect(e.frame).toBeLessThanOrEqual(n - 1);
        if (k > 0) { expect(e.tau).toBeGreaterThanOrEqual(f[k - 1]!.tau); expect(e.frame).toBeGreaterThanOrEqual(f[k - 1]!.frame); }
      }
      const worst = f.findIndex((e) => e.isWorst);
      expect(f.filter((e) => e.isWorst)).toHaveLength(1);
      const ds = f.map((e) => Math.abs(e.tau - w));
      const minD = Math.min(...ds);
      expect(worst).toBe(ds.indexOf(minD));
      if (w - 0.35 >= 0 && w + 0.35 <= T) {
        expect(f[0]!.tau).toBeCloseTo(w - 0.35, 9);
        expect(f[7]!.tau).toBeCloseTo(w + 0.35, 9);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 46: Replay position stays in range
  it('keeps the replay time in range, steps one frame, pauses on seek and stops at the end', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('advance' as const), v: fc.double({ min: 0, max: 5, noNaN: true }) }),
      fc.record({ k: fc.constant('seek' as const), v: fc.integer({ min: -10, max: 500 }) }),
      fc.record({ k: fc.constant('step' as const), v: fc.constantFrom(1, -1) }),
      fc.record({ k: fc.constant('play' as const), v: fc.constant(0) }),
    );
    fc.assert(fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 60 }), fc.boolean(), fc.array(op, { maxLength: 40 }), (n, fps, reduced, ops) => {
      const r = new ReplayController({
        hero: { snapshot() {}, restore() {}, pause() {}, resume() {} }, scheduler: { acquire() {}, release() {} }, reduced: () => reduced,
      });
      r.load(synthPoses(1, n, fps), 0);
      r.enter();
      for (const o of ops) {
        const before = r.t;
        const fi = r.frameIndex;
        if (o.k === 'advance') {
          r.advance(o.v);
          if (reduced) expect(r.t).toBe(before);
          if (r.t >= r.duration && o.v > 0 && !reduced) expect(r.playing).toBe(false);
        } else if (o.k === 'seek') {
          r.seekFrame(o.v);
          expect(r.playing).toBe(false);
        } else if (o.k === 'step') {
          r.stepFrame(o.v as 1 | -1);
          const target = fi + o.v;
          if (target >= 0 && target <= n - 1) expect(r.t).toBeCloseTo(target / fps, 9);
          else expect(r.frameIndex).toBe(fi);
          expect(r.playing).toBe(false);
        } else r.play();
        expect(r.t).toBeGreaterThanOrEqual(0);
        expect(r.t).toBeLessThanOrEqual(r.duration + 1e-12);
      }
    }), R);
  });
});
