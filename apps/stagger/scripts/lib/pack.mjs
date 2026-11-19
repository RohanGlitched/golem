// policy.bin: the eight float32 tensors of Unitree's G1 policy in a small container.
//   [u32 LE header length H][H bytes UTF-8 JSON header, space padded so the data starts 4-byte aligned][float32 tensors]

/** @typedef {{ name: string, shape: number[] }} TensorSpec */
/** @typedef {{ commit: string, gateOrder: 'ifgo', tensors: Array<{ name: string, shape: number[], offset: number, bytes: number }> }} PolicyHeader */

/** @type {readonly TensorSpec[]} */
export const WEIGHT_SPECS = [
  { name: 'W1', shape: [32, 64] },
  { name: 'b1', shape: [32] },
  { name: 'W2', shape: [12, 32] },
  { name: 'b2', shape: [12] },
  { name: 'Wih', shape: [256, 47] },
  { name: 'Whh', shape: [256, 64] },
  { name: 'bih', shape: [256] },
  { name: 'bhh', shape: [256] },
];

/** @type {Record<string, string>} */
export const ZIP_ENTRY_FOR = Object.fromEntries(
  WEIGHT_SPECS.map((s, i) => [s.name, `policy_lstm_1/data/${i + 2}`]),
);

const count = (shape) => shape.reduce((a, b) => a * b, 1);

/**
 * @param {Map<string, Uint8Array>} entries zip entries of motion.pt
 * @returns {Record<string, Float32Array>}
 */
export function extractWeights(entries) {
  /** @type {Record<string, Float32Array>} */ const out = {};
  for (const spec of WEIGHT_SPECS) {
    const entry = /** @type {string} */ (ZIP_ENTRY_FOR[spec.name]);
    const bytes = entries.get(entry);
    if (bytes === undefined) throw new Error(`policy archive is missing entry ${entry}`);
    const expected = 4 * count(spec.shape);
    if (bytes.length !== expected) {
      throw new Error(`policy entry ${entry} (${spec.name}): expected ${expected} bytes, got ${bytes.length} bytes`);
    }
    out[spec.name] = new Float32Array(new Uint8Array(bytes).buffer);
  }
  return out;
}

/**
 * @param {Record<string, Float32Array>} w
 * @param {string} commit
 * @returns {Uint8Array}
 */
export function packPolicy(w, commit) {
  for (const s of WEIGHT_SPECS) {
    const t = w[s.name];
    if (t === undefined || t.length !== count(s.shape)) throw new Error(`tensor ${s.name} must have ${count(s.shape)} values`);
  }
  const build = (start) => {
    let off = start;
    const tensors = WEIGHT_SPECS.map((s) => {
      const bytes = 4 * count(s.shape);
      const t = { name: s.name, shape: [...s.shape], offset: off, bytes };
      off += bytes;
      return t;
    });
    return { header: { commit, gateOrder: 'ifgo', tensors }, end: off };
  };
  const enc = new TextEncoder();
  let start = 0;
  let json = '';
  for (let i = 0; i < 8; i++) {
    const { header } = build(start);
    json = JSON.stringify(header);
    let len = enc.encode(json).length;
    len += (4 - ((4 + len) % 4)) % 4;
    const next = 4 + len;
    if (next === start) break;
    start = next;
  }
  const { header, end } = build(start);
  json = JSON.stringify(header);
  const jb = enc.encode(json);
  const hlen = start - 4;
  if (jb.length > hlen) throw new Error('policy header did not converge');
  const out = new Uint8Array(end);
  out.fill(0x20, 4, start);
  new DataView(out.buffer).setUint32(0, hlen, true);
  out.set(jb, 4);
  for (const t of header.tensors) {
    const src = /** @type {Float32Array} */ (w[t.name]);
    out.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), t.offset);
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ header: PolicyHeader, tensors: Record<string, Float32Array> }}
 */
export function unpackPolicy(bytes) {
  if (bytes.length < 4) throw new Error('policy.bin is shorter than its 4-byte header length');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(0, true);
  if (4 + hlen > bytes.length) throw new Error(`policy.bin header length ${hlen} exceeds the file size ${bytes.length}`);
  /** @type {PolicyHeader} */
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hlen)));
  /** @type {Record<string, Float32Array>} */ const tensors = {};
  for (const t of header.tensors) {
    if (t.offset % 4 !== 0 || t.offset + t.bytes > bytes.length) {
      throw new Error(`policy.bin tensor ${t.name} has offset ${t.offset} and ${t.bytes} bytes outside a ${bytes.length}-byte file`);
    }
    tensors[t.name] = new Float32Array(new Uint8Array(bytes.subarray(t.offset, t.offset + t.bytes)).buffer);
  }
  return { header, tensors };
}