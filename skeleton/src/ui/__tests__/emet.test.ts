// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { CRUMBLE_S, EMET_HINT, HEAD_BAND, WIDTH_MAX, WIDTH_MIN, emetTarget, foreheadSpot, stepCrumble } from '../core/emet.js';
import { EmetDecal, HINT_KEY, bodyPoints, highestBody } from '../signature/emet-decal.js';
import { TOKENS } from '../core/theme-tokens.js';
import { buildStage } from '../stage/stage-builder.js';
import { FakeStorage } from './fakes.js';

describe('foreheadSpot', () => {
  it('puts the decal on the front of the head band of a box body', () => {
    // A 0.2 m wide, 0.1 m deep body from z 0 to 1: the head band is z >= 0.82.
    const pts: number[] = [];
    for (const x of [-0.05, 0.05]) for (const y of [-0.1, 0.1]) for (let z = 0; z <= 1.0001; z += 0.01) pts.push(x, y, z);
    const s = foreheadSpot(pts)!;
    expect(s.at[0]).toBeCloseTo(0.05, 9);
    expect(s.at[1]).toBeCloseTo(0, 9);
    expect(s.at[2]).toBeGreaterThan(0.82);
    expect(s.at[2]).toBeLessThan(1);
    expect(s.normal).toEqual([1, 0, 0]);
    expect(s.width).toBeCloseTo(0.11, 9);
  });
  it('returns nothing for no points', () => { expect(foreheadSpot([])).toBeUndefined(); });

  // Feature: golem-signature, Property 4: Forehead placement
  it('stays inside the bounding box, in the top 18 %, with a width in [0.02, 0.2] m', () => {
    const arbPts = fc.array(fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 2, noNaN: true })), { minLength: 1, maxLength: 80 });
    fc.assert(fc.property(arbPts, (ps) => {
      const flat = ps.flat();
      const s = foreheadSpot(flat)!;
      const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]), zs = ps.map((p) => p[2]);
      const zTop = Math.max(...zs), zMin = Math.min(...zs);
      expect(s.at[0]).toBeLessThanOrEqual(Math.max(...xs));
      expect(s.at[0]).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(s.at[1]).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-12);
      expect(s.at[1]).toBeLessThanOrEqual(Math.max(...ys) + 1e-12);
      expect(s.at[2]).toBeLessThanOrEqual(zTop + 1e-12);
      expect(s.at[2]).toBeGreaterThanOrEqual(zTop - HEAD_BAND * (zTop - zMin) - 1e-12);
      expect(s.width).toBeGreaterThanOrEqual(WIDTH_MIN);
      expect(s.width).toBeLessThanOrEqual(WIDTH_MAX);
    }), { numRuns: 200 });
  });
});

describe('emetTarget and stepCrumble', () => {
  it('reads "met" for a broken line, keeps the word while running, and re-forms otherwise', () => {
    expect(emetTarget('broken', 'emet')).toBe('met');
    expect(emetTarget('running', 'met')).toBe('met');
    expect(emetTarget('running', 'emet')).toBe('emet');
    expect(emetTarget('held', 'met')).toBe('emet');
    expect(emetTarget('untested', 'met')).toBe('emet');
    expect(emetTarget(undefined, 'met')).toBe('emet');
  });
  it('crumbles over 0.9 s, re-forms faster, and jumps under reduced motion', () => {
    expect(stepCrumble(0, 'met', CRUMBLE_S / 2, false)).toBeCloseTo(0.5, 9);
    expect(stepCrumble(0.9, 'met', 1, false)).toBe(1);
    expect(stepCrumble(1, 'emet', 0.3, false)).toBeCloseTo(0.5, 9);
    expect(stepCrumble(0, 'met', 0.01, true)).toBe(1);
  });
});

function decal(storage = new FakeStorage()) {
  const host = document.createElement('div');
  const said: string[] = [];
  const d = new EmetDecal({ THREE, tokens: TOKENS.dark, spot: { at: [0.1, 0, 0.4], normal: [1, 0, 0], width: 0.06 }, hintHost: host, storage, reduced: () => false, announce: (m) => said.push(m) });
  return { d, host, said, storage };
}

describe('EmetDecal', () => {
  it('faces along the normal at the spot, as one plane with the "e" left of "met" as seen from the front', () => {
    const { d } = decal();
    d.group.updateMatrixWorld(true);
    expect(d.group.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(1);
    const pe = new THREE.Vector3(d.eCentreX, 0, 0).applyMatrix4(d.group.matrixWorld);
    const pm = new THREE.Vector3(d.metCentreX, 0, 0).applyMatrix4(d.group.matrixWorld);
    // Seen from +x, the viewer's right is +y.
    expect(pe.y).toBeLessThan(pm.y);
    expect(pe.x).toBeGreaterThan(0.1);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(d.group.quaternion);
    expect(n.x).toBeCloseTo(1, 9);
    d.dispose();
  });
  it('crumbles when told "met", shows the hint once per device, and re-forms', () => {
    const { d, host, said, storage } = decal();
    expect(d.setWord('met', 1000)).toBe(true);
    expect(host.textContent).toBe(EMET_HINT);
    expect(said).toEqual([EMET_HINT]);
    expect(storage.getItem(HINT_KEY)).toBe('1');
    let t = 1000;
    while (d.update((t += 16))) { /* animating */ }
    expect(d.crumble).toBe(1);
    expect(d.animating).toBe(false);
    expect(d.group.getObjectByProperty('type', 'Points')!.visible).toBe(false);
    d.setWord('emet', t);
    while (d.update((t += 16))) { /* animating */ }
    expect(d.crumble).toBe(0);
    d.setWord('met', t);
    expect(said).toHaveLength(1);
    d.dispose();
    const again = decal(storage);
    again.d.setWord('met', 0);
    expect(again.host.textContent).toBe('');
    again.d.dispose();
  });
});

describe('bodyPoints and highestBody', () => {
  it('finds the body that reaches highest and returns its vertices in the body frame', () => {
    const model = {
      nbody: 3, ngeom: 2, geom_type: [6, 6], geom_group: [2, 2], geom_bodyid: [1, 2], geom_dataid: [-1, -1],
      geom_size: [0.1, 0.1, 0.1, 0.1, 0.1, 0.3], geom_pos: [0, 0, 0, 0, 0, 0.5], geom_quat: [1, 0, 0, 0, 1, 0, 0, 0],
      mesh_vertadr: [], mesh_vertnum: [], mesh_faceadr: [], mesh_facenum: [], mesh_vert: [], mesh_face: [],
    };
    const parts = buildStage(model, THREE, new THREE.MeshBasicMaterial());
    expect(highestBody(THREE, parts)).toBe(2);
    const pts = bodyPoints(THREE, parts, 2);
    let zMax = -Infinity;
    for (let i = 2; i < pts.length; i += 3) zMax = Math.max(zMax, pts[i] as number);
    expect(zMax).toBeCloseTo(0.8, 6);
  });
});
