// How far the source vertices of a triangle soup lie outside the planes of a hull's faces (metres, positive = outside).
// The hull builder (scripts/lib/hull.mjs) works in float64 on float32 vertices and treats anything within FLAT_M of a
// plane or line as flat. The check has to share both limits to stay meaningful:
//  - A face thinner than FLAT_M (its height over its longest edge) has no plane the builder could honour: its normal is
//    rounding noise and may even point inward, so a source vertex measures metres "outside" it. Such faces are skipped.
//    The other faces still enclose every vertex, and a hull that left a real vertex out would show on them.
//  - Vertices are float32, so a distance is known to a few float32 spacings of the largest coordinate (2^-23 relative).

/** The builder's flatness threshold in metres (isFlat in scripts/lib/hull.mjs). */
export const FLAT_M = 1e-6;
const F32_EPS = 2 ** -23;

/** Tolerance in metres for a soup whose largest coordinate magnitude is `maxAbs`: the flatness threshold plus 4 float32 spacings. */
export const enclosureTolerance = (maxAbs: number): number => FLAT_M + 4 * F32_EPS * maxAbs;

export function maxOutside(hull: Float32Array, tris: Float32Array): { worst: number; facesChecked: number } {
  let worst = -Infinity;
  let facesChecked = 0;
  for (let f = 0; f < hull.length; f += 9) {
    const a = [hull[f]!, hull[f + 1]!, hull[f + 2]!], b = [hull[f + 3]!, hull[f + 4]!, hull[f + 5]!], c = [hull[f + 6]!, hull[f + 7]!, hull[f + 8]!];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!], w = [c[0]! - b[0]!, c[1]! - b[1]!, c[2]! - b[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    const longest = Math.max(Math.hypot(u[0]!, u[1]!, u[2]!), Math.hypot(v[0]!, v[1]!, v[2]!), Math.hypot(w[0]!, w[1]!, w[2]!));
    if (len === 0 || len / longest <= FLAT_M) continue; // thinner than the builder's flatness threshold: no plane to test against
    facesChecked++;
    for (let i = 0; i < tris.length; i += 3) {
      const d = ((tris[i]! - a[0]!) * n[0]! + (tris[i + 1]! - a[1]!) * n[1]! + (tris[i + 2]! - a[2]!) * n[2]!) / len;
      if (d > worst) worst = d;
    }
  }
  return { worst, facesChecked };
}

export const maxAbsCoordinate = (tris: Float32Array): number => tris.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
