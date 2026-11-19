// Mesh pipeline: visual meshes are simplified to at most 3000 faces with meshoptimizer; collision meshes are
// simplified to at most 200 faces and stored as convex hulls (MuJoCo collides meshes by their hull anyway).
import { MeshoptSimplifier } from 'meshoptimizer';
import qh from 'quickhull3d';
import { faceCount, weld } from './obj.mjs';

/** @typedef {import('./obj.mjs').Mesh} Mesh */

export const MAX_VISUAL_FACES = 3000;
export const MAX_COLLISION_FACES = 200;

// quickhull3d is CommonJS with exports.default.
const quickhull = typeof qh === 'function' ? qh : /** @type {any} */ (qh).default;

/** Keeps only the vertices that triangles use, in order of first use. @param {Float32Array} pos @param {Uint32Array} idx @returns {Mesh} */
function compact(pos, idx) {
  const remap = new Int32Array(pos.length / 3).fill(-1);
  /** @type {number[]} */ const out = [];
  const idx2 = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const v = /** @type {number} */ (idx[i]);
    let r = /** @type {number} */ (remap[v]);
    if (r < 0) { r = out.length / 3; remap[v] = r; out.push(/** @type {number} */ (pos[3 * v]), /** @type {number} */ (pos[3 * v + 1]), /** @type {number} */ (pos[3 * v + 2])); }
    idx2[i] = r;
  }
  return { pos: new Float32Array(out), idx: idx2 };
}

/**
 * Reduces a mesh to at most `maxFaces` triangles. Returns the (welded) input when it is small enough.
 * @param {Mesh} mesh @param {number} maxFaces @returns {Promise<Mesh>}
 */
export async function simplify(mesh, maxFaces) {
  const m = weld(mesh.pos, mesh.idx);
  if (faceCount(m) <= maxFaces) return m;
  await MeshoptSimplifier.ready;
  let [out] = MeshoptSimplifier.simplify(m.idx, m.pos, 3, 3 * maxFaces, 1, []);
  let n = out.length / 3;
  if (n > maxFaces) {
    // The simplifier could not reach the cap by collapses alone: keep the largest triangles.
    const pos = m.pos;
    const area = (t) => {
      const a = 3 * /** @type {number} */ (out[3 * t]), b = 3 * /** @type {number} */ (out[3 * t + 1]), c = 3 * /** @type {number} */ (out[3 * t + 2]);
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    };
    const order = Array.from({ length: n }, (_, i) => i)
      .sort((p, q) => area(q) - area(p) || p - q).slice(0, maxFaces).sort((p, q) => p - q);
    const kept = new Uint32Array(3 * order.length);
    order.forEach((t, i) => { kept.set(out.subarray(3 * t, 3 * t + 3), 3 * i); });
    out = kept; n = order.length;
  }
  return compact(m.pos, out);
}

/** True when all points lie within 1e-6 of one plane or line: no hull with volume exists. @param {number[][]} pts */
function isFlat(pts) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const p0 = /** @type {number[]} */ (pts[0]);
  let p1 = p0, d1 = 0;
  for (const p of pts) { const d = norm(sub(p, p0)); if (d > d1) { d1 = d; p1 = p; } }
  if (d1 === 0) return true;
  const e1 = sub(p1, p0);
  let n = [0, 0, 0], nn = 0;
  for (const p of pts) { const c = cross(e1, sub(p, p0)); const mag = norm(c); if (mag > nn) { nn = mag; n = c; } }
  if (nn <= 1e-6 * d1) return true;
  let h = 0;
  for (const p of pts) { const s = sub(p, p0); h = Math.max(h, Math.abs(s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) / nn); }
  return h <= 1e-6;
}

/**
 * Convex hull of the mesh vertices, as an indexed mesh with outward winding.
 * @param {Mesh} mesh @param {string} [name] for error messages @returns {Mesh}
 */
export function convexHull(mesh, name = 'mesh') {
  const used = new Set(mesh.idx);
  /** @type {number[][]} */ const pts = [];
  for (const v of [...used].sort((a, b) => a - b)) {
    pts.push([/** @type {number} */ (mesh.pos[3 * v]), /** @type {number} */ (mesh.pos[3 * v + 1]), /** @type {number} */ (mesh.pos[3 * v + 2])]);
  }
  if (pts.length < 4 || isFlat(pts)) throw new Error(`${name}: fewer than 4 non-coplanar vertices`);
  /** @type {number[][]} */ const faces = quickhull(pts);
  if (faces.length < 4) throw new Error(`${name}: fewer than 4 non-coplanar vertices`);
  const pos = new Float32Array(3 * pts.length);
  pts.forEach((p, i) => pos.set(p, 3 * i));
  const idx = new Uint32Array(3 * faces.length);
  faces.forEach((f, i) => idx.set(/** @type {number[]} */ (f), 3 * i));
  return compact(pos, idx);
}

/** Visual mesh: at most `maxFaces` faces. @param {Mesh} mesh @param {number} [maxFaces] */
export function visualMesh(mesh, maxFaces = MAX_VISUAL_FACES) {
  return simplify(mesh, maxFaces);
}

/**
 * Collision mesh: simplified to at most `maxFaces` faces, then the convex hull of the result. When the hull
 * of the simplified mesh has more faces than the cap, the target shrinks until it fits.
 * @param {Mesh} mesh @param {string} [name] @param {number} [maxFaces] @returns {Promise<Mesh>}
 */
export async function collisionMesh(mesh, name = 'mesh', maxFaces = MAX_COLLISION_FACES) {
  let target = maxFaces;
  for (;;) {
    const hull = convexHull(await simplify(mesh, target), name);
    if (faceCount(hull) <= maxFaces) return hull;
    const next = Math.floor(target * 0.8);
    if (next < 4) throw new Error(`${name}: no convex hull with at most ${maxFaces} faces was found`);
    target = next;
  }
}
