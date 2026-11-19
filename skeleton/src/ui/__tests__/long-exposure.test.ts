import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { TrailStore } from '../core/trails.js';
import { PHOTO_MEASURE, photoFonts, photoLayout, wrap } from '../core/photo.js';
import { TrailsView } from '../signature/trails-view.js';
import { TOKENS } from '../core/theme-tokens.js';

const HELD = [0.1, 0.2, 0.3] as const, BROKEN = [0.9, 0.1, 0.1] as const;

function frames(nbody: number, n: number, f: (i: number, b: number) => [number, number, number]): Float32Array {
  const out = new Float32Array(nbody * 7 * n);
  for (let i = 0; i < n; i++) for (let b = 0; b < nbody; b++) {
    const o = (i * nbody + b) * 7;
    const [x, y, z] = f(i, b);
    out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = 1;
  }
  return out;
}

describe('TrailStore', () => {
  it('keeps the first and last point and downsamples to the point budget', () => {
    const s = new TrailStore(4, 8);
    expect(s.add(frames(2, 100, (i, b) => [i, b, 0]), 2, 1, false)).toBe(true);
    expect(s.len[0]).toBe(8);
    expect(s.pts[0]).toBe(0);
    expect(s.pts[3 * 7]).toBe(99);
    expect(s.pts[1]).toBe(1);
  });
  it('stops at the first non-finite frame and rejects a path of one point', () => {
    const s = new TrailStore(4, 8);
    const f = frames(1, 5, (i) => [i, 0, 0]);
    f[2 * 7] = Number.NaN;
    expect(s.add(f, 1, 0, false)).toBe(true);
    expect(s.len[0]).toBe(2);
    expect(s.add(frames(1, 1, () => [0, 0, 0]), 1, 0, false)).toBe(false);
  });
  it('counts what it drops when full', () => {
    const s = new TrailStore(1, 4);
    s.add(frames(1, 3, (i) => [i, 0, 0]), 1, 0, false);
    expect(s.add(frames(1, 3, (i) => [i, 0, 0]), 1, 0, true)).toBe(false);
    expect(s.dropped).toBe(1);
  });

  // Feature: golem-signature, Property 7: Trails
  it('writes 2 × (k − 1) vertices per path, from that path, coloured by its verdict, never past the capacity', () => {
    const arbPath = fc.record({
      n: fc.integer({ min: 0, max: 60 }), broken: fc.boolean(), off: fc.integer({ min: 0, max: 1000 }),
    });
    fc.assert(fc.property(fc.array(arbPath, { maxLength: 12 }), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 2, max: 10 }), (paths, cap, pts) => {
      const s = new TrailStore(cap, pts);
      const kept: { k: number; off: number; broken: boolean }[] = [];
      for (const p of paths) {
        if (s.add(frames(1, p.n, (i) => [p.off + i, p.off, 0]), 1, 0, p.broken)) kept.push({ k: Math.min(p.n, pts), off: p.off, broken: p.broken });
      }
      expect(s.count).toBeLessThanOrEqual(cap);
      const pos = new Float32Array(3 * s.maxVertices), col = new Float32Array(3 * s.maxVertices);
      const v = s.writeSegments(pos, col, HELD, BROKEN);
      expect(v).toBe(kept.reduce((a, t) => a + 2 * (t.k - 1), 0));
      let at = 0;
      for (const t of kept) {
        for (let j = 0; j < 2 * (t.k - 1); j++, at++) {
          expect(pos[3 * at + 1]).toBe(t.off);
          expect(pos[3 * at]).toBeGreaterThanOrEqual(t.off);
          expect(col[3 * at]).toBeCloseTo(t.broken ? BROKEN[0] : HELD[0], 6);
        }
      }
      // A smaller output buffer is never overrun.
      const small = new Float32Array(9);
      expect(s.writeSegments(small, new Float32Array(9), HELD, BROKEN)).toBeLessThanOrEqual(3);
    }), { numRuns: 200 });
  });
});

describe('photoLayout', () => {
  const measure = (t: string, f: string): number => t.length * (parseInt(f, 10) * 0.55);
  it('sets the id, the wrapped sentence and the note in the lower-left corner at 2×', () => {
    const lines = photoLayout({ width: 2000, height: 1200, scale: 2, id: 'Requirement 1.2', note: '480 trials, 31 broken', measure,
      text: 'WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE robot SHALL stay upright for 3 s' });
    const f = photoFonts(2);
    expect(lines[0]).toMatchObject({ text: 'Requirement 1.2', x: f.margin, ink: 'ink2' });
    expect(lines.at(-1)).toMatchObject({ text: '480 trials, 31 broken', y: 1200 - f.margin });
    expect(lines.slice(1, -1).map((l) => l.text).join(' ')).toMatch(/^WHEN the pelvis .* for 3 s$/);
    for (const l of lines.slice(1, -1)) expect(measure(l.text, l.font)).toBeLessThanOrEqual(PHOTO_MEASURE * 2000);
  });
  it('keeps a number and its unit on one line', () => {
    const lines = wrap('pushed for 0.2 s from behind', '10px x', measure('pushed for 0.2', '10px x'), measure);
    expect(lines.some((l) => l.includes('0.2 s'))).toBe(true);
  });
  it('wraps greedily and keeps every word', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-z]{1,12}$/), { maxLength: 40 }), fc.integer({ min: 20, max: 400 }), (words, w) => {
      const lines = wrap(words.join(' '), '10px x', w, measure);
      expect(lines.join(' ')).toBe(words.join(' '));
      for (const l of lines) if (l.includes(' ')) expect(measure(l, '10px x')).toBeLessThanOrEqual(w);
    }), { numRuns: 200 });
  });
});

describe('TrailsView', () => {
  it('rebuilds one merged line geometry when shown and draws nothing while empty', () => {
    const v = new TrailsView(THREE, TOKENS.dark, 'dark', new TrailStore(8, 4));
    expect(v.lines.geometry.drawRange.count).toBe(0);
    v.add(frames(2, 10, (i) => [i, 0, 1]), 2, 1, true);
    v.add(frames(2, 10, (i) => [i, 1, 1]), 2, 1, false);
    v.rebuild();
    expect(v.vertices).toBe(0);
    v.setVisible(true);
    expect(v.vertices).toBe(12);
    expect(v.lines.geometry.drawRange.count).toBe(12);
    const col = v.lines.geometry.getAttribute('color').array as Float32Array;
    const red = new THREE.Color(TOKENS.dark.break);
    expect(col[0]).toBeCloseTo(red.r, 6);
    expect((v.lines.material as THREE.LineBasicMaterial).blending).toBe(THREE.AdditiveBlending);
    v.setTheme(TOKENS.light, 'light');
    expect((v.lines.material as THREE.LineBasicMaterial).blending).toBe(THREE.NormalBlending);
    v.clear();
    expect(v.lines.geometry.drawRange.count).toBe(0);
    v.dispose();
  });
});
