// Ghost level of detail: ghosts are translucent rim-lit shapes, so they need a fraction of the hero's
// triangles. Vertex clustering on a uniform grid: every vertex snaps to its grid cell's mean position,
// triangles that collapse are dropped, duplicates removed. Pure and deterministic; no three.js here.

export interface ClusteredMesh { positions: Float32Array; index: Uint32Array }

/**
 * Simplifies a triangle mesh by clustering vertices into cubes of side `cell` metres.
 * `positions` holds xyz per vertex; `index` (optional) holds 3 vertex ids per triangle, else the
 * positions are a triangle soup. Returns an indexed mesh whose triangle count never exceeds the input's.
 */
export function clusterSimplify(positions: ArrayLike<number>, index: ArrayLike<number> | null, cell: number): ClusteredMesh {
  const nv = Math.floor(positions.length / 3);
  const inv = 1 / cell;
  const clusterOf = new Int32Array(nv);
  const keyToCluster = new Map<string, number>();
  const sum: number[] = [];
  const count: number[] = [];
  const add = (i: number, v: number): void => { sum[i] = (sum[i] as number) + v; };
  for (let v = 0; v < nv; v++) {
    const x = positions[3 * v] as number, y = positions[3 * v + 1] as number, z = positions[3 * v + 2] as number;
    const key = `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
    let c = keyToCluster.get(key);
    if (c === undefined) { c = count.length; keyToCluster.set(key, c); count.push(0); sum.push(0, 0, 0); }
    clusterOf[v] = c;
    add(3 * c, x); add(3 * c + 1, y); add(3 * c + 2, z); count[c] = (count[c] as number) + 1;
  }
  const nt = index ? Math.floor(index.length / 3) : Math.floor(nv / 3);
  const seen = new Set<string>();
  const tris: number[] = [];
  for (let t = 0; t < nt; t++) {
    const a = clusterOf[index ? (index[3 * t] as number) : 3 * t] as number;
    const b = clusterOf[index ? (index[3 * t + 1] as number) : 3 * t + 1] as number;
    const c = clusterOf[index ? (index[3 * t + 2] as number) : 3 * t + 2] as number;
    if (a === b || b === c || a === c) continue;
    // Dedupe regardless of winding start, keep the first winding seen.
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const k = `${lo},${mid},${hi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    tris.push(a, b, c);
  }
  // Compact the clusters that survive into the output vertex list.
  const remap = new Int32Array(count.length).fill(-1);
  const out: number[] = [];
  const idx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const c = tris[i] as number;
    if ((remap[c] as number) < 0) {
      remap[c] = out.length / 3;
      const n = count[c] as number;
      out.push((sum[3 * c] as number) / n, (sum[3 * c + 1] as number) / n, (sum[3 * c + 2] as number) / n);
    }
    idx[i] = remap[c] as number;
  }
  return { positions: Float32Array.from(out), index: idx };
}

/** Grid size for a mesh of the given bounding-box diagonal: about 1/28 of it, at least 10 mm. */
export const ghostCell = (diagonal: number): number => Math.max(0.01, diagonal / 28);
