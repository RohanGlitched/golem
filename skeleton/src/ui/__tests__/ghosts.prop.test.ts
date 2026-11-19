import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FADE_S, OPACITY_RUNNING, OPACITY_SURVIVOR, SUMMON_S, breakTime, evalGhost, newGhostEval, recordingSeconds,
} from '../ghosts/ghost-state.js';
import type { GhostRecord } from '../ghosts/ghost-state.js';
import { resolveArrow } from '../ghosts/push-arrow.js';
import { arbRobustness } from './generators/aura.js';

const R = { numRuns: 100 };

const arbRecord: fc.Arbitrary<GhostRecord> = fc.record({
  robustness: arbRobustness,
  worstAt: fc.oneof(fc.double({ min: -1, max: 5, noNaN: true }), fc.constant(0.2)),
  warmup: fc.double({ min: 0, max: 1, noNaN: true }),
  fps: fc.integer({ min: 1, max: 60 }),
  frameCount: fc.integer({ min: 1, max: 200 }),
  validFrames: fc.constant(1e9),
}).map((g) => ({ ...g, validFrames: g.frameCount }));
const arbTau = fc.double({ min: 0, max: 10, noNaN: true });

describe('ghost state properties', () => {
  // Feature: golem-studio-ui, Property 15: Break state if and only if robustness is below zero
  it('turns to the break colour only when robustness < 0 and after the break time', () => {
    fc.assert(fc.property(arbRecord, arbTau, fc.boolean(), (g, tau, reduced) => {
      const e = evalGhost(g, tau, reduced, newGhostEval());
      const tb = breakTime(g);
      expect(tb).toBeGreaterThanOrEqual(0);
      expect(tb).toBeLessThanOrEqual(recordingSeconds(g));
      if (e.breakMix === 1) { expect(g.robustness < 0).toBe(true); expect(tau >= tb).toBe(true); }
      if (g.robustness < 0 && tau >= tb) expect(e.breakMix).toBe(1);
      if (!(g.robustness < 0)) {
        expect(e.breakMix).toBe(0);
        const settled = evalGhost(g, Math.max(tau, SUMMON_S), reduced, newGhostEval());
        expect(settled.opacity).toBe(OPACITY_SURVIVOR);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 16: Break fade and summon bounds
  it('fades a broken ghost monotonically to 0 by tBreak + 0.6 s and rises over 0.4 s', () => {
    fc.assert(fc.property(arbRecord, arbTau, arbTau, fc.boolean(), (g, a, b, reduced) => {
      const [t1, t2] = a <= b ? [a, b] : [b, a];
      const e1 = evalGhost(g, t1, reduced, newGhostEval());
      const e2 = evalGhost(g, t2, reduced, newGhostEval());
      if (reduced) {
        expect(e1.rise).toBe(0);
        if (g.robustness < 0) expect(e1.opacity).toBe(t1 >= breakTime(g) ? 0 : OPACITY_RUNNING);
      } else {
        expect(evalGhost(g, 0, false, newGhostEval()).rise).toBe(1);
        expect(e2.rise).toBeLessThanOrEqual(e1.rise);
        if (t1 >= SUMMON_S) expect(e1.rise).toBe(0);
      }
      const tb = breakTime(g);
      if (g.robustness < 0 && t1 >= Math.max(tb, SUMMON_S)) expect(e2.opacity).toBeLessThanOrEqual(e1.opacity);
      if (g.robustness < 0 && t1 >= tb + FADE_S) { expect(e1.opacity).toBe(0); expect(e1.hidden).toBe(true); }
      expect(e1.opacity).toBeGreaterThanOrEqual(0);
      expect(e1.opacity).toBeLessThanOrEqual(OPACITY_RUNNING);
    }), R);
  });

  // Feature: golem-studio-ui, Property 23: Push arrow direction and length
  it('points the arrow along the force with length clamp(0.3 |F| / 100, 0.05, 0.9)', () => {
    const v = fc.double({ min: -2000, max: 2000, noNaN: true });
    fc.assert(fc.property(v, v, v, fc.boolean(), (fx, fy, fz, hasVisual) => {
      const tpl = {
        phrase: 'p', dims: () => [], apply: () => {},
        ...(hasVisual ? { visual: () => ({ force: [fx, fy, fz] as [number, number, number], at: 'b' }) } : {}),
      };
      const a = resolveArrow({ template: 'p', params: {} }, tpl, {}, () => 1);
      const m = Math.hypot(fx, fy, fz);
      if (!hasVisual || m === 0) { expect(a).toBeUndefined(); return; }
      expect(a).toBeDefined();
      expect(a!.length).toBeCloseTo(Math.min(0.9, Math.max(0.05, (0.3 * m) / 100)), 12);
      expect(a!.length).toBeGreaterThanOrEqual(0.05);
      expect(a!.length).toBeLessThanOrEqual(0.9);
      expect(a!.dir[0]).toBeCloseTo(fx / m, 12);
      expect(a!.dir[1]).toBeCloseTo(fy / m, 12);
      expect(a!.dir[2]).toBeCloseTo(fz / m, 12);
      expect(a!.body).toBe(1);
    }), R);
  });
});
