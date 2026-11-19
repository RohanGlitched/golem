// Minimal zip reader (stored and deflate entries, node:zlib only) and a writer used by tests.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/**
 * @param {Uint8Array} zip
 * @returns {Map<string, Uint8Array>} entry name to bytes (copies)
 */
export function readZipEntries(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== CEN) throw new Error('zip: bad central directory entry');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (dv.getUint32(local, true) !== LOC) throw new Error(`zip: bad local header for ${name}`);
    const lname = dv.getUint16(local + 26, true);
    const lextra = dv.getUint16(local + 28, true);
    const start = local + 30 + lname + lextra;
    const raw = zip.subarray(start, start + csize);
    if (method === 0) out.set(name, new Uint8Array(raw));
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw)));
    else throw new Error(`zip: entry ${name} uses unsupported compression method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a zip. Used by tests and fixtures, not by the pipeline itself.
 * @param {Array<{ name: string, data: Uint8Array, deflate?: boolean }>} entries
 * @returns {Uint8Array}
 */
export function writeZip(entries) {
  const enc = new TextEncoder();
  /** @type {Uint8Array[]} */ const parts = [];
  /** @type {Uint8Array[]} */ const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const body = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const method = e.deflate ? 8 : 0;
    const crc = crc32(e.data);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, LOC, true); l.setUint16(4, 20, true); l.setUint16(8, method, true);
    l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, e.data.length, true);
    l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, CEN, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, method, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    ch.set(name, 46);
    parts.push(lh, body); central.push(ch);
    offset += lh.length + body.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let q = 0;
  for (const a of all) { out.set(a, q); q += a.length; }
  return out;
}