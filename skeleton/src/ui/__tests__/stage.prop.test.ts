import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { GEOM, buildStage } from '../stage/stage-builder.js';
import { pixelRatioFor } from '../stage/stage.js';
import { arbModel, modelFrom } from './generators/model.js';

const R = { numRuns: 100 };
const mat = new THREE.MeshBasicMaterial();
const SUPPORTED = new Set([0, 2, 3, 4, 5, 6, 7]);

describe('stage properties', () => {
  // Feature: golem-studio-ui, Property 1: Stage mesh count and group filter
  it('creates one mesh per supported, non-empty geom of group 2 and skips the rest with one warning each', () => {
    fc.assert(fc.property(arbModel, ({ geoms, model }) => {
      const p = buildStage(model, THREE, mat);
      const drawn = geoms.map((g, i) => ({ g, i })).filter(({ g }) => g.group === 2 && SUPPORTED.has(g.type) && g.type !== GEOM.plane && !(g.type === GEOM.mesh && g.mesh === 1));
      expect(p.meshCount).toBe(drawn.length);
      expect(p.meshes.length).toBe(p.meshCount);
      drawn.forEach(({ g, i }, k) => {
        expect(p.meshes[k]!.userData['geom']).toBe(i);
        expect(p.meshes[k]!.parent).toBe(p.bodyGroups[g.body]);
      });
      const skippedIds = p.skipped.map((s) => s.geom);
      geoms.forEach((g, i) => {
        const isSkipped = g.group !== 2 || !SUPPORTED.has(g.type) || (g.type === GEOM.mesh && g.mesh === 1);
        expect(skippedIds.includes(i)).toBe(isSkipped);
      });
      const bad = geoms.filter((g) => g.group === 2 && (!SUPPORTED.has(g.type) || (g.type === GEOM.mesh && g.mesh === 1))).length;
      expect(p.warnings.length).toBe(bad);
    }), R);
  });

  // Feature: golem-studio-ui, Property 2: Primitive extents match MuJoCo
  it('sizes primitives to the MuJoCo definition, meshes to their faces and planes to at least 20 m', () => {
    const s = fc.double({ min: 0.01, max: 5, noNaN: true });
    fc.assert(fc.property(fc.constantFrom(0, 2, 3, 4, 5, 6, 7), s, s, s, (type, a, b, c) => {
      const p = buildStage(modelFrom(1, [{ type, group: 2, body: 0, mesh: 0, size: [a, b, c] }]), THREE, mat);
      if (type === GEOM.plane) { expect(p.floor!.halfExtent).toBe(Math.max(a, b, 20)); return; }
      const geo = p.meshes[0]!.geometry;
      if (type === GEOM.mesh) {
        const pos = geo.getAttribute('position');
        expect(pos.count).toBe(3 * 4);
        const face = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
        const vert = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
        for (let k = 0; k < 12; k++) for (let j = 0; j < 3; j++) expect(pos.getComponent(k, j)).toBeCloseTo(vert[3 * face[k]! + j]!, 6);
        return;
      }
      geo.computeBoundingBox();
      const size = new THREE.Vector3();
      geo.boundingBox!.getSize(size);
      const want: [number, number, number] =
        type === GEOM.box ? [2 * a, 2 * b, 2 * c]
          : type === GEOM.sphere ? [2 * a, 2 * a, 2 * a]
            : type === GEOM.capsule ? [2 * a, 2 * a, 2 * (a + b)]
              : type === GEOM.cylinder ? [2 * a, 2 * a, 2 * b]
                : [2 * a, 2 * b, 2 * c];
      const tol = (w: number) => Math.max(1e-6 * w, type === GEOM.box ? 1e-6 * w : 0.02 * w);
      expect(Math.abs(size.x - want[0])).toBeLessThanOrEqual(tol(want[0]));
      expect(Math.abs(size.y - want[1])).toBeLessThanOrEqual(tol(want[1]));
      expect(Math.abs(size.z - want[2])).toBeLessThanOrEqual(type === GEOM.box || type === GEOM.cylinder || type === GEOM.capsule ? 1e-6 * want[2] : tol(want[2]));
    }), R);
  });

  // Feature: golem-studio-ui, Property 3: Stage build is deterministic
  it('builds byte-equal geometry twice from the same model', () => {
    fc.assert(fc.property(arbModel, ({ model }) => {
      const a = buildStage(model, THREE, mat), b = buildStage(model, THREE, mat);
      expect(a.meshCount).toBe(b.meshCount);
      expect(a.skipped).toEqual(b.skipped);
      for (let i = 0; i < a.meshCount; i++) {
        for (const attr of ['position', 'normal']) {
          const x = a.meshes[i]!.geometry.getAttribute(attr).array as Float32Array;
          const y = b.meshes[i]!.geometry.getAttribute(attr).array as Float32Array;
          expect(Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength))).toBe(true);
        }
        expect(a.geomInfo[i]!.local).toEqual(b.geomInfo[i]!.local);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 12: Pixel ratio cap
  it('sets the pixel ratio to min(devicePixelRatio, 1.5)', () => {
    fc.assert(fc.property(fc.double({ min: 1e-3, max: 8, noNaN: true }), (dpr) => {
      expect(pixelRatioFor(dpr)).toBe(Math.min(dpr, 1.5));
    }), R);
  });
});
