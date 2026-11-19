import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AURA_BINS, AuraModel, binOf, binRadius, boundaryForce, encodeTexels, radiusAt } from '../aura/aura-model.js';
import { auraSummary } from '../aura/aura-summary.js';
import { formatSig } from '../core/format.js';
import { arbAuraTrials } from './generators/aura.js';
import type { AuraTrial } from './generators/aura.js';

const R = { numRuns: 100 };
const TAU = 2 * Math.PI;

function build(trials: AuraTrial[], fmax = 300): AuraModel {
  const m = new AuraModel(fmax);
  for (const t of trials) m.add(t.angle, t.force, t.robustness);
  return m;
}

/** Naive reference, written independently of the model. */
function reference(trials: AuraTrial[]) {
  const held: number[] = Array(36).fill(-Infinity);
  const broke: number[] = Array(36).fill(Infinity);
  const ticks: AuraTrial[] = [];
  let ignored = 0;
  for (const t of trials) {
    if (Number.isNaN(t.robustness)) { ignored++; continue; }
    const turns = t.angle / TAU;
    const bin = Math.min(35, Math.floor((turns - Math.floor(turns)) * 36));
    if (t.robustness >= 0) held[bin] = Math.max(held[bin]!, t.force);
    else { broke[bin] = Math.min(broke[bin]!, t.force); ticks.push(t); }
  }
  ticks.sort((p, q) => p.force - q.force || p.angle - q.angle);
  return { held, broke, ticks: ticks.slice(0, 512).map((t) => ({ angle: t.angle, force: t.force })), ignored, total: trials.length };
}

describe('aura properties', () => {
  // Feature: golem-studio-ui, Property 24: Aura bins match a reference model
  it('matches a naive reference model bin for bin', () => {
    fc.assert(fc.property(arbAuraTrials, (trials) => {
      const m = build(trials);
      const r = reference(trials);
      expect(m.held.length).toBe(AURA_BINS);
      expect(m.broke.length).toBe(AURA_BINS);
      expect([...m.held]).toEqual(r.held);
      expect([...m.broke]).toEqual(r.broke);
      expect(m.ticks).toEqual(r.ticks);
      expect(m.ignored).toBe(r.ignored);
      expect(m.total).toBe(r.total);
      for (let i = 0; i < 36; i++) {
        const inBin = trials.filter((t) => !Number.isNaN(t.robustness) && binOf(t.angle) === i);
        const heldF = inBin.filter((t) => t.robustness >= 0).map((t) => t.force);
        const brokeF = inBin.filter((t) => t.robustness < 0).map((t) => t.force);
        if (heldF.length) expect(m.held[i]).toBeLessThanOrEqual(Math.max(...heldF));
        if (brokeF.length) expect(m.broke[i]).toBeGreaterThanOrEqual(Math.min(...brokeF));
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 25: Aura is order independent
  it('gives the same bins, ticks and counts for any order of the same trials', () => {
    fc.assert(fc.property(arbAuraTrials.chain((t) => fc.tuple(fc.constant(t), fc.shuffledSubarray(t, { minLength: t.length, maxLength: t.length }))), ([a, b]) => {
      const ma = build(a), mb = build(b);
      expect([...ma.held]).toEqual([...mb.held]);
      expect([...ma.broke]).toEqual([...mb.broke]);
      expect(ma.ticks).toEqual(mb.ticks);
      expect([ma.total, ma.ignored]).toEqual([mb.total, mb.ignored]);
    }), R);
  });

  // Feature: golem-studio-ui, Property 26: Aura angle wrap
  it('puts a and a + 2 pi k in the same bin, within one step next to a bin edge', () => {
    fc.assert(fc.property(fc.double({ min: -100, max: 100, noNaN: true }), fc.integer({ min: -50, max: 50 }), (a, k) => {
      const b0 = binOf(a), b1 = binOf(a + TAU * k);
      expect(b0).toBeGreaterThanOrEqual(0); expect(b0).toBeLessThanOrEqual(35);
      expect(b1).toBeGreaterThanOrEqual(0); expect(b1).toBeLessThanOrEqual(35);
      const turns = a / TAU;
      const pos = (turns - Math.floor(turns)) * 36;
      const distToEdge = Math.min(pos - Math.floor(pos), Math.ceil(pos) - pos) * (TAU / 36);
      if (distToEdge > 1e-9) expect(b1).toBe(b0);
      else expect(Math.min((b1 - b0 + 36) % 36, (b0 - b1 + 36) % 36)).toBeLessThanOrEqual(1);
    }), R);
  });

  // Feature: golem-studio-ui, Property 27: Aura radius and smoothing
  it('scales radii to 1.2 min(1, B/forceMax), never overshoots between bins and encodes within 1.2/510 m', () => {
    fc.assert(fc.property(arbAuraTrials, fc.double({ min: 1, max: 400, noNaN: true }), fc.double({ min: -10, max: 10, noNaN: true }), (trials, fmax, ang) => {
      const m = build(trials, fmax);
      const tex = new Uint8Array(36 * 4);
      encodeTexels(m, tex);
      for (let i = 0; i < 36; i++) {
        const B = boundaryForce(m, i);
        const r = binRadius(m, i);
        expect(r).toBe(B === undefined ? 0 : 1.2 * Math.min(1, B / fmax));
        expect(Math.abs((tex[4 * i]! / 255) * 1.2 - r)).toBeLessThanOrEqual(1.2 / 510 + 1e-12);
      }
      const u = (((ang / TAU) % 1) + 1) % 1 * 36 - 0.5;
      const i0 = ((Math.floor(u) % 36) + 36) % 36, i1 = (i0 + 1) % 36;
      const lo = Math.min(binRadius(m, i0), binRadius(m, i1)), hi = Math.max(binRadius(m, i0), binRadius(m, i1));
      const v = radiusAt(m, ang);
      expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(v).toBeLessThanOrEqual(hi + 1e-12);
    }), R);
  });

  // Feature: golem-studio-ui, Property 28: Aura summary names the weakest direction
  it('names the lowest bin with the smallest broken force, or the strongest held push', () => {
    fc.assert(fc.property(arbAuraTrials, (trials) => {
      const m = build(trials);
      const s = auraSummary(m);
      const broke = [...m.broke];
      const minB = Math.min(...broke);
      if (minB !== Infinity) {
        const i = broke.indexOf(minB);
        expect(s).toContain(`${5 + 10 * i} deg`);
        expect(s).toContain(`${formatSig(minB, 3)} N`);
      } else {
        const held = [...m.held];
        const maxH = Math.max(...held);
        if (maxH === -Infinity) expect(s).toBe('No trials yet');
        else {
          const j = held.indexOf(maxH);
          expect(s).toContain(`${5 + 10 * j} deg`);
          expect(s).toContain(`in ${m.total} trials`);
        }
      }
    }), R);
  });
});
