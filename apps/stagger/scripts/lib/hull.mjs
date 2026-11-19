// Convex hull of a triangle soup, as a triangle soup with outward winding.
import qh from 'quickhull3d';

// quickhull3d is CommonJS with exports.default.
const quickhull = typeof qh === 'function' ? qh : /** @type {any} */ (qh).default;

/**
 * @param {Float32Array} tris 9 floats per triangle
 * @param {string} name mesh name for error messages
 * @returns {Float32Array}
 */
export function buildHull(tris, name) {
  /** @type {Map<string, number>} */ const seen = new Map();
  /** @type {number[][]} */ const pts = [];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const key = `${tris[i]},${tris[i + 1]},${tris[i + 2]}`;
    if (!seen.has(key)) { seen.set(key, pts.length); pts.push([tris[i], tris[i + 1], tris[i + 2]]); }
  }
  /** @type {number[][]} */ let faces;
  try {
    if (pts.length < 4 || isFlat(pts)) throw new Error('degenerate');
    faces = quickhull(pts);
  } catch {
    throw new Error(`${name}: fewer than 4 non-coplanar vertices`);
  }
  if (faces.length < 4) throw new Error(`${name}: fewer than 4 non-coplanar vertices`);
  const out = new Float32Array(9 * faces.length);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = pts[/** @type {number[]} */ (f)[k]];
      out.set(/** @type {number[]} */ (p), 9 * i + 3 * k);
    }
  });
  return out;
}
/** True when all points lie within 1e-6 m of one plane (or one line): no hull with a real volume exists. */
function isFlat(pts) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const p0 = pts[0];
  let p1 = p0, d1 = 0;
  for (const p of pts) { const d = norm(sub(p, p0)); if (d > d1) { d1 = d; p1 = p; } }
  if (d1 === 0) return true;
  const e1 = sub(p1, p0);
  let n = [0, 0, 0], nn = 0;
  for (const p of pts) { const c = cross(e1, sub(p, p0)); const m = norm(c); if (m > nn) { nn = m; n = c; } }
  if (nn <= 1e-6 * d1) return true;
  let h = 0;
  for (const p of pts) { const s = sub(p, p0); h = Math.max(h, Math.abs(s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) / nn); }
  return h <= 1e-6;
}