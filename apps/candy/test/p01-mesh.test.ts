// Feature: candy-app, Property 1: Mesh pipeline respects face bounds
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collisionMesh, visualMesh } from '../scripts/lib/mesh.mjs';
import { faceCount, type Mesh } from '../scripts/lib/obj.mjs';

/** A heightfield grid: nx * ny cells, two triangles each, random heights. */
const grid = (nx: number, ny: number, h: number[]): Mesh => {
  const pos = new Float32Array(3 * (nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i;
    pos[3 * k] = i * 0.01; pos[3 * k + 1] = j * 0.01; pos[3 * k + 2] = h[k % h.length]! * 0.02;
  }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  return { pos, idx: Uint32Array.from(idx) };
};

const heights = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 32, maxLength: 64 });

describe('mesh pipeline properties', () => {
  it('visual meshes never exceed 3000 faces', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 10, max: 60 }), fc.integer({ min: 10, max: 60 }), heights, async (nx, ny, h) => {
      const out = await visualMesh(grid(nx, ny, h));
      expect(faceCount(out)).toBeLessThanOrEqual(3000);
      expect(faceCount(out)).toBeGreaterThan(0);
      for (const v of out.pos) expect(Number.isFinite(v)).toBe(true);
    }), { numRuns: 100 });
  });

  it('collision meshes are convex with at most 200 faces and use only input vertices', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 4, max: 60 }), fc.integer({ min: 4, max: 60 }), heights, async (nx, ny, h) => {
      // A mesh whose vertices are all coplanar has no hull; the pipeline reports it (see assets.libs.test.ts).
      const input = grid(nx, ny, h);
      const zs = Array.from(input.pos).filter((_, i) => i % 3 === 2);
      fc.pre(Math.max(...zs) - Math.min(...zs) > 0.001);
      const hull = await collisionMesh(input, 'generated');
      expect(faceCount(hull)).toBeLessThanOrEqual(200);
      // Every vertex lies on or inside every face plane (outward winding): the mesh is convex.
      const p = hull.pos, ix = hull.idx;
      for (let t = 0; t < ix.length; t += 3) {
        const a = 3 * ix[t]!, b = 3 * ix[t + 1]!, c = 3 * ix[t + 2]!;
        const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
        const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
        let nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
        const len = Math.hypot(nx_, ny_, nz_);
        if (len === 0) continue;
        nx_ /= len; ny_ /= len; nz_ /= len;
        for (let v = 0; v < p.length; v += 3) {
          const d = (p[v]! - p[a]!) * nx_ + (p[v + 1]! - p[a + 1]!) * ny_ + (p[v + 2]! - p[a + 2]!) * nz_;
          expect(d).toBeLessThanOrEqual(1e-5);
        }
      }
      // Hull vertices are vertices of the input mesh.
      const inputKeys = new Set<string>();
      for (let v = 0; v < input.pos.length; v += 3) inputKeys.add(`${input.pos[v]},${input.pos[v + 1]},${input.pos[v + 2]}`);
      for (let v = 0; v < p.length; v += 3) expect(inputKeys.has(`${p[v]},${p[v + 1]},${p[v + 2]}`)).toBe(true);
    }), { numRuns: 100 });
  });
});
