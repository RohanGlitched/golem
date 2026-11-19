// OBJ and binary STL parsing, and OBJ writing with fixed number formatting.
// An indexed mesh is { pos: Float32Array (3 per vertex), idx: Uint32Array (3 per triangle) }.

/** @typedef {{ pos: Float32Array, idx: Uint32Array }} Mesh */

/**
 * Parses the `v` and `f` lines of an OBJ file. Polygons are fan-triangulated; negative indices are
 * relative; other lines are ignored. Vertices with identical positions are welded.
 * @param {string} text
 * @returns {Mesh}
 */
export function parseObj(text) {
  /** @type {number[]} */ const raw = [];
  /** @type {number[]} */ const tris = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      raw.push(Number(p[1]), Number(p[2]), Number(p[3]));
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1);
      const ids = p.map((tok) => {
        const n = Number.parseInt(tok.split('/')[0] ?? '', 10);
        if (!Number.isInteger(n) || n === 0) throw new Error(`OBJ: bad face index "${tok}"`);
        return n > 0 ? n - 1 : raw.length / 3 + n;
      });
      for (let k = 1; k + 1 < ids.length; k++) tris.push(/** @type {number} */ (ids[0]), /** @type {number} */ (ids[k]), /** @type {number} */ (ids[k + 1]));
    }
  }
  const nv = raw.length / 3;
  for (const i of tris) if (i < 0 || i >= nv) throw new Error(`OBJ: face index ${i + 1} is outside 1..${nv}`);
  return weld(new Float32Array(raw), Uint32Array.from(tris));
}

/**
 * Merges vertices with identical float32 positions and drops degenerate triangles and unused vertices.
 * @param {Float32Array} pos @param {Uint32Array} idx @returns {Mesh}
 */
export function weld(pos, idx) {
  /** @type {Map<string, number>} */ const seen = new Map();
  /** @type {number[]} */ const outPos = [];
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const take = (v) => {
    const cached = remap[v];
    if (cached !== undefined && cached >= 0) return cached;
    const x = /** @type {number} */ (pos[3 * v]), y = /** @type {number} */ (pos[3 * v + 1]), z = /** @type {number} */ (pos[3 * v + 2]);
    const key = `${x},${y},${z}`;
    let id = seen.get(key);
    if (id === undefined) { id = outPos.length / 3; seen.set(key, id); outPos.push(x, y, z); }
    remap[v] = id;
    return id;
  };
  /** @type {number[]} */ const outIdx = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = take(/** @type {number} */ (idx[t])), b = take(/** @type {number} */ (idx[t + 1])), c = take(/** @type {number} */ (idx[t + 2]));
    if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
  }
  return { pos: new Float32Array(outPos), idx: Uint32Array.from(outIdx) };
}

/**
 * Binary STL to a welded indexed mesh.
 * @param {Uint8Array} buf @returns {Mesh}
 */
export function parseBinaryStl(buf) {
  if (buf.length < 84) throw new Error(`STL: ${buf.length} bytes is shorter than the 84-byte header`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.length !== 84 + 50 * n) {
    throw new Error(`STL: header says ${n} triangles (${84 + 50 * n} bytes) but the file has ${buf.length} bytes`);
  }
  const pos = new Float32Array(9 * n);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i + 12;
    for (let k = 0; k < 9; k++) pos[9 * i + k] = dv.getFloat32(o + 4 * k, true);
  }
  const idx = new Uint32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) idx[i] = i;
  return weld(pos, idx);
}

/** @param {number} x @returns {string} */
export function fmt6(x) {
  const s = x.toFixed(6);
  return s === '-0.000000' ? '0.000000' : s;
}

/**
 * Writes an OBJ with `v` and `f` lines only, positions with 6 decimals, 1-based indices.
 * @param {Mesh} mesh @returns {string}
 */
export function writeObj(mesh) {
  const lines = ['# golem candy robot mesh'];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    lines.push(`v ${fmt6(/** @type {number} */ (mesh.pos[i]))} ${fmt6(/** @type {number} */ (mesh.pos[i + 1]))} ${fmt6(/** @type {number} */ (mesh.pos[i + 2]))}`);
  }
  for (let i = 0; i < mesh.idx.length; i += 3) {
    lines.push(`f ${/** @type {number} */ (mesh.idx[i]) + 1} ${/** @type {number} */ (mesh.idx[i + 1]) + 1} ${/** @type {number} */ (mesh.idx[i + 2]) + 1}`);
  }
  return `${lines.join('\n')}\n`;
}

/** @param {Mesh} m @returns {number} triangle count */
export function faceCount(m) { return m.idx.length / 3; }
