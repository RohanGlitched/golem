// Full model snapshot and restore (golem-sim-hardening defect 6, improvement 5).
// Every mjModel array lives in `model.buffer`, so one copy of that buffer plus every field of
// `model.opt` captures all the state a trial can change. `vis` and `stat` do not affect dynamics.
import type { MjModel } from '@mujoco/mujoco';

/** A model as the sim sees it: the typed bindings, or a stand-in (test fakes have no buffer or opt). */
type AnyModel = MjModel | Record<string, any>;

export interface ModelSnapshot {
  /** Copy of `model.buffer`, or undefined when the model has none. */
  buffer: Uint8Array | undefined;
  /** Every number and typed-array field of `model.opt`, copied. */
  opt: Array<[string, number | Float64Array]>;
}

const SNAPSHOTS = new WeakMap<object, ModelSnapshot>();

function isTyped(v: unknown): v is ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function protoFields(obj: object): string[] {
  const names = new Set<string>();
  for (let p = Object.getPrototypeOf(obj); p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor') names.add(n);
  }
  for (const n of Object.keys(obj)) names.add(n);
  return [...names];
}

function readOpt(model: AnyModel): Array<[string, number | Float64Array]> {
  const opt = (model as any).opt;
  if (opt === undefined || opt === null || typeof opt !== 'object') return [];
  const out: Array<[string, number | Float64Array]> = [];
  for (const name of protoFields(opt)) {
    let v: unknown;
    try { v = opt[name]; } catch { continue; }
    if (typeof v === 'number') out.push([name, v]);
    else if (isTyped(v)) out.push([name, Float64Array.from(v as ArrayLike<number>)]);
  }
  return out;
}

/** Copies the whole model (buffer and opt) and records the copy as this model's snapshot. */
export function takeModelSnapshot(model: AnyModel): ModelSnapshot {
  const buf = (model as any).buffer;
  const snap: ModelSnapshot = { buffer: buf instanceof Uint8Array ? Uint8Array.from(buf) : undefined, opt: readOpt(model) };
  SNAPSHOTS.set(model as object, snap);
  return snap;
}

/** The snapshot taken when the model was compiled, or a new one on first use. */
export function modelSnapshot(model: AnyModel): ModelSnapshot {
  return SNAPSHOTS.get(model as object) ?? takeModelSnapshot(model);
}

/** Puts the whole model back to its snapshot: one memcpy of the buffer, then every opt field. */
export function restoreModelSnapshot(model: AnyModel, snap: ModelSnapshot = modelSnapshot(model)): void {
  const m = model as any;
  if (snap.buffer !== undefined) (m.buffer as Uint8Array).set(snap.buffer);
  if (snap.opt.length === 0) return;
  const opt = m.opt;
  for (const [name, value] of snap.opt) {
    if (typeof value === 'number') {
      if (!Object.is(opt[name], value)) opt[name] = value;
    } else {
      (opt[name] as Float64Array).set(value);
    }
  }
}

interface FieldRange { name: string; start: number; end: number }
const LAYOUTS = new WeakMap<object, FieldRange[]>();

/** Byte ranges of every model array inside `model.buffer`, by field name. */
function layoutOf(model: AnyModel): FieldRange[] {
  const cached = LAYOUTS.get(model as object);
  if (cached !== undefined) return cached;
  const m = model as any;
  const buf = m.buffer;
  const ranges: FieldRange[] = [];
  if (buf instanceof Uint8Array) {
    for (const name of protoFields(m)) {
      if (name === 'buffer') continue;
      let v: unknown;
      try { v = m[name]; } catch { continue; }
      if (!isTyped(v) || v.buffer !== buf.buffer || v.byteLength === 0) continue;
      const start = v.byteOffset - buf.byteOffset;
      if (start < 0 || start + v.byteLength > buf.byteLength) continue;
      ranges.push({ name, start, end: start + v.byteLength });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  LAYOUTS.set(model as object, ranges);
  return ranges;
}

/** Names of the model arrays (and `opt.<field>`s) that differ from the snapshot, in buffer order. */
export function changedModelFields(model: AnyModel, snap: ModelSnapshot = modelSnapshot(model)): string[] {
  const m = model as any;
  const changed: string[] = [];
  if (snap.buffer !== undefined) {
    const cur = m.buffer as Uint8Array;
    const ranges = layoutOf(model);
    const seen = new Set<string>();
    let unnamed = false;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === snap.buffer[i]) continue;
      const r = ranges.find((x) => i >= x.start && i < x.end);
      if (r === undefined) unnamed = true;
      else if (!seen.has(r.name)) { seen.add(r.name); changed.push(r.name); }
    }
    if (unnamed) changed.push('buffer');
  }
  const now = new Map(readOpt(model));
  for (const [name, value] of snap.opt) {
    const v = now.get(name);
    const same = typeof value === 'number'
      ? Object.is(v, value)
      : v instanceof Float64Array && v.length === value.length && v.every((x, i) => Object.is(x, value[i]));
    if (!same) changed.push(`opt.${name}`);
  }
  return changed;
}
