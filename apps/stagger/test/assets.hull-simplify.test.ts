import { describe, expect, it } from 'vitest';
import { buildHull } from '../scripts/lib/hull.mjs';
import { buildVisual } from '../scripts/lib/simplify.mjs';

function cube(): Float32Array {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const out = new Float32Array(f.length * 9);
  f.forEach((t, i) => t.forEach((k, j) => out.set(v[k] as number[], 9 * i + 3 * j)));
  return out;
}

function sphere(nu: number, nv: number): Float32Array {
  const pt = (i: number, j: number): number[] => {
    const th = (Math.PI * i) / nu, ph = (2 * Math.PI * j) / nv;
    return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  };
  const tris: number[] = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new Float32Array(tris);
}

describe('buildHull', () => {
  it('turns a cube into 12 triangles that cover its 8 corners', () => {
    const h = buildHull(cube(), 'cube');
    expect(h.length / 9).toBe(12);
    const corners = new Set<string>();
    for (let i = 0; i < h.length; i += 3) corners.add(`${h[i]},${h[i + 1]},${h[i + 2]}`);
    expect(corners.size).toBe(8);
  });
  it('throws with the mesh name for a flat quad', () => {
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(() => buildHull(quad, 'flat_quad.STL')).toThrow('flat_quad.STL: fewer than 4 non-coplanar vertices');
  });
});

describe('buildVisual', () => {
  it('reduces a 10,000 triangle sphere to at most 3,000 triangles', async () => {
    const s = sphere(100, 50);
    expect(s.length / 9).toBeGreaterThanOrEqual(9000);
    const v = await buildVisual(s);
    expect(v.length / 9).toBeLessThanOrEqual(3000);
    expect(v.length / 9).toBeGreaterThan(100);
  });
  it('returns a small mesh unchanged', async () => {
    const c = cube();
    expect(await buildVisual(c)).toBe(c);
  });
});