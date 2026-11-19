import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_TILT_WORDS, LEAN_CAP_DEG, forceFraction, fractureSignal, fractureWord, fuseFill, leanDeg, livingSegments } from '../tablet/living.js';
import { arbLine } from './generators/line.js';

const arbQuat = fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }),
  fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }))
  .filter(([w, x, y, z]) => Math.hypot(w, x, y, z) > 1e-3)
  .map(([w, x, y, z]) => { const n = Math.hypot(w, x, y, z); return [w / n, x / n, y / n, z / n] as const; });
const arbRight = fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }).map((a) => [Math.cos(a), Math.sin(a), 0] as const);

describe('living sentence properties', () => {
  // Feature: golem-signature, Property 1: Bound words
  it('concatenates back to the line and binds words by the rules', () => {
    fc.assert(fc.property(arbLine, (line) => {
      const segs = livingSegments(line);
      expect(segs.map((s) => s.text).join('')).toBe(line);
      const shall = segs.find((s) => s.kind === 'keyword' && s.text === 'SHALL');
      for (const s of segs) {
        expect(s.response).toBe(!!shall && s.start >= shall.end);
        if (s.kind === 'word') expect(s.bind === 'tilt').toBe(DEFAULT_TILT_WORDS.includes(s.text.toLowerCase()));
      }
      const fuse = segs.filter((s) => s.bind === 'fuse');
      expect(fuse.length).toBeLessThanOrEqual(1);
      if (fuse[0]) {
        expect(fuse[0].response).toBe(true);
        expect(fuse[0].q?.kind).toBe('duration');
        const first = segs.find((s) => s.kind === 'quantity' && s.response && s.q?.kind === 'duration');
        expect(first).toBe(fuse[0]);
      }
      expect(segs.filter((s) => s.bind === 'force').length).toBeLessThanOrEqual(1);
    }), { numRuns: 200 });
  });

  // Feature: golem-signature, Property 2: Lean, fuse and force are bounded and monotone
  it('bounds the lean to 12 degrees and flips its sign with the right vector', () => {
    fc.assert(fc.property(arbQuat, arbRight, ([w, x, y, z], [rx, ry, rz]) => {
      const a = leanDeg(w, x, y, z, rx, ry, rz);
      expect(Math.abs(a)).toBeLessThanOrEqual(LEAN_CAP_DEG);
      const b = leanDeg(w, x, y, z, -rx, -ry, -rz);
      expect(b).toBeCloseTo(-a, 9);
    }), { numRuns: 200 });
  });
  it('keeps fuse and force fractions in [0, 1] and never lowers them as the input grows', () => {
    fc.assert(fc.property(fc.double({ min: -10, max: 100, noNaN: true }), fc.double({ min: 0, max: 50, noNaN: true }),
      fc.double({ min: 0.01, max: 500, noNaN: true }), (t, dt, w) => {
        const a = fuseFill(t, w), b = fuseFill(t + dt, w);
        expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1); expect(b).toBeGreaterThanOrEqual(a);
        const fa = forceFraction(Math.abs(t), w), fb = forceFraction(Math.abs(t) + dt, w);
        expect(fa).toBeGreaterThanOrEqual(0); expect(fb).toBeLessThanOrEqual(1); expect(fb).toBeGreaterThanOrEqual(fa);
      }), { numRuns: 200 });
  });

  // Feature: golem-signature, Property 3: Fracture_Signal
  it('picks a negative signal with no earlier negative one, and none when no margin is negative', () => {
    const arbM = fc.dictionary(fc.constantFrom('a', 'b', 'c', 'pelvis_z', 'tilt_deg'),
      fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: 0, max: 10, noNaN: true })), { minKeys: 1 });
    fc.assert(fc.property(arbM, (d) => {
      const margins: Record<string, number> = {}, at: Record<string, number> = {};
      for (const [k, [m, t]] of Object.entries(d)) { margins[k] = m; at[k] = t; }
      const s = fractureSignal(margins, at);
      const neg = Object.keys(margins).filter((k) => (margins[k] as number) < 0);
      if (neg.length === 0) { expect(s).toBeUndefined(); return; }
      expect(s).toBeDefined();
      expect(margins[s!]).toBeLessThan(0);
      for (const k of neg) expect(at[k]).toBeGreaterThanOrEqual(at[s!] as number);
    }), { numRuns: 200 });
  });
  it('returns a fracture word inside the response clause', () => {
    fc.assert(fc.property(arbLine, fc.constantFrom('pelvis_z', 'tilt_deg', 'box.z', 'bob.angle', 'x'), (line, sig) => {
      const segs = livingSegments(line);
      const w = fractureWord(segs, sig);
      const hasWords = segs.some((s) => s.kind === 'word' && s.response);
      expect(w !== undefined).toBe(hasWords);
      if (w) expect(segs.some((s) => s.kind === 'word' && s.response && s.start === w.start && s.end === w.end)).toBe(true);
    }), { numRuns: 200 });
  });
});
