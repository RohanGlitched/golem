import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clusterSimplify, ghostCell } from '../ghosts/ghost-lod.js';

/** A UV sphere as a triangle soup, radius r, with seg x ring segments. */
function sphereSoup(r: number, seg: number, ring: number): Float32Array {
  const pts: number[] = [];
  const p = (i: number, j: number) => {
    const th = (Math.PI * j) / ring, ph = (2 * Math.PI * i) / seg;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    pts.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return Float32Array.from(pts);
}

describe('ghost level of detail', () => {
  it('cuts a dense sphere to a small fraction of its triangles and keeps its size', () => {
    const soup = sphereSoup(0.1, 96, 64);           // 12,288 triangles
    const out = clusterSimplify(soup, null, ghostCell(0.35));
    const tris = out.index.length / 3;
    expect(tris).toBeLessThan(12288 / 5);   // grid = 1/28 of the part's diagonal
    expect(tris).toBeGreaterThan(40);
    let maxR = 0;
    for (let v = 0; v < out.positions.length / 3; v++) maxR = Math.max(maxR, Math.hypot(out.positions[3 * v]!, out.positions[3 * v + 1]!, out.positions[3 * v + 2]!));
    expect(maxR).toBeGreaterThan(0.08);
    expect(maxR).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  it('never adds triangles, never emits a degenerate or out-of-range index, and is deterministic', () => {
    fc.assert(fc.property(fc.integer({ min: 4, max: 40 }), fc.integer({ min: 3, max: 30 }), fc.double({ min: 0.005, max: 0.2, noNaN: true }),
      (seg, ring, cell) => {
        const soup = sphereSoup(0.1, seg, ring);
        const a = clusterSimplify(soup, null, cell), b = clusterSimplify(soup, null, cell);
        expect(Array.from(a.index)).toEqual(Array.from(b.index));
        expect(a.index.length / 3).toBeLessThanOrEqual(soup.length / 9);
        const nv = a.positions.length / 3;
        for (let t = 0; t < a.index.length; t += 3) {
          const x = a.index[t]!, y = a.index[t + 1]!, z = a.index[t + 2]!;
          expect(x !== y && y !== z && x !== z).toBe(true);
          expect(Math.max(x, y, z)).toBeLessThan(nv);
        }
      }), { numRuns: 100 });
  });
});
