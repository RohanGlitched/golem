// Binary STL parsing and writing. A mesh is a Float32Array of 9 floats per triangle.

/** @param {Uint8Array} buf @returns {Float32Array} */
export function parseBinaryStl(buf) {
  if (buf.length < 84) throw new Error(`STL: ${buf.length} bytes is shorter than the 84-byte header`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.length !== 84 + 50 * n) {
    throw new Error(`STL: header says ${n} triangles (${84 + 50 * n} bytes) but the file has ${buf.length} bytes`);
  }
  const out = new Float32Array(9 * n);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i + 12;
    for (let k = 0; k < 9; k++) out[9 * i + k] = dv.getFloat32(o + 4 * k, true);
  }
  return out;
}

/** @param {Float32Array} tris @returns {Uint8Array} length 84 + 50 * n; normals are recomputed */
export function writeBinaryStl(tris) {
  const n = tris.length / 9;
  if (!Number.isInteger(n)) throw new Error(`STL: ${tris.length} floats is not a multiple of 9`);
  const out = new Uint8Array(84 + 50 * n);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('golem stagger robot mesh'), 0);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const t = 9 * i;
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0 && Number.isFinite(len)) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
    const o = 84 + 50 * i;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + 4 * k, tris[t + k], true);
  }
  return out;
}

/** Hull and visual files of one source mesh. The source name is kept whole so distinct sources never collide. */
/** @param {string} source @returns {string} */
export function hullName(source) { return `${source}.hull.stl`; }
/** @param {string} source @returns {string} */
export function visualName(source) { return `${source}.vis.stl`; }