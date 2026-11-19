// Visual mesh reduction with the meshoptimizer simplifier.
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * Reduces a triangle soup to at most `maxTris` triangles. Returns the input unchanged when it is small enough.
 * @param {Float32Array} tris 9 floats per triangle
 * @param {number} [maxTris]
 * @returns {Float32Array}
 */
export async function buildVisual(tris, maxTris = 3000) {
  const n = tris.length / 9;
  if (n <= maxTris) return tris;
  await MeshoptSimplifier.ready;
  // Weld identical positions into an indexed mesh.
  /** @type {Map<string, number>} */ const seen = new Map();
  const verts = [];
  const idx = new Uint32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) {
    const x = tris[3 * i], y = tris[3 * i + 1], z = tris[3 * i + 2];
    const key = `${x},${y},${z}`;
    let id = seen.get(key);
    if (id === undefined) { id = verts.length / 3; seen.set(key, id); verts.push(x, y, z); }
    idx[i] = id;
  }
  const pos = new Float32Array(verts);
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, 3 * maxTris, 1, []);
  let m = out.length / 3;
  if (m > maxTris) {
    // Could not reach the cap by collapses: keep the largest triangles.
    const area = (t) => {
      const a = out[3 * t] * 3, b = out[3 * t + 1] * 3, c = out[3 * t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    };
    const order = Array.from({ length: m }, (_, i) => i).sort((p, q) => area(q) - area(p) || p - q).slice(0, maxTris).sort((p, q) => p - q);
    const kept = new Uint32Array(3 * order.length);
    order.forEach((t, i) => { kept.set(out.subarray(3 * t, 3 * t + 3), 3 * i); });
    out = kept; m = order.length;
  }
  const res = new Float32Array(9 * m);
  for (let i = 0; i < 3 * m; i++) {
    res[3 * i] = pos[3 * out[i]]; res[3 * i + 1] = pos[3 * out[i] + 1]; res[3 * i + 2] = pos[3 * out[i] + 2];
  }
  return res;
}