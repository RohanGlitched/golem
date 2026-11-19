// The living sentence: which words of a line are bound to which live value, and the bounded values themselves. Pure.
import { parseQuantity } from '../../ears/index.js';
import { formatSig } from '../core/format.js';
import { segmentLine } from './segments.js';
import type { Segment } from './segments.js';
import type { Dimension, Scenario, ScenarioSpace } from '../types.js';

export const LEAN_CAP_DEG = 12;
export const DEFAULT_TILT_WORDS: readonly string[] = ['upright', 'level', 'vertical', 'balanced', 'standing', 'straight', 'steady'];

export type Bind = 'tilt' | 'fuse' | 'force';

export interface LivingSegment {
  kind: Segment['kind'] | 'word';
  text: string;
  start: number;
  end: number;
  q?: Segment['q'];
  /** True for the words after SHALL. */
  response: boolean;
  bind?: Bind;
}

const WORD = /[A-Za-z][A-Za-z'\u2019-]*/g;

/**
 * The tablet's segments, with the plain text of the Response_Clause split into words. A word in the tilt set is
 * bound to `tilt`; the first duration quantity of the Response_Clause to `fuse`; the largest force quantity to `force`.
 */
export function livingSegments(text: string, tiltWords: readonly string[] = DEFAULT_TILT_WORDS): LivingSegment[] {
  const segs = segmentLine(text);
  const shall = segs.findIndex((s) => s.kind === 'keyword' && s.text === 'SHALL');
  const respFrom = shall >= 0 ? (segs[shall] as Segment).end : Infinity;
  const tilt = new Set(tiltWords.map((w) => w.toLowerCase()));
  const out: LivingSegment[] = [];
  let force: { i: number; si: number } | undefined;
  let fuse = -1;
  for (const s of segs) {
    const response = s.start >= respFrom;
    if (s.kind === 'plain' && response) {
      let pos = s.start;
      const body = s.text;
      WORD.lastIndex = 0;
      for (let m = WORD.exec(body); m; m = WORD.exec(body)) {
        const ws = s.start + m.index, we = ws + m[0].length;
        if (ws > pos) out.push({ kind: 'plain', text: text.slice(pos, ws), start: pos, end: ws, response });
        out.push({ kind: 'word', text: m[0], start: ws, end: we, response, ...(tilt.has(m[0].toLowerCase()) ? { bind: 'tilt' as const } : {}) });
        pos = we;
      }
      if (pos < s.end) out.push({ kind: 'plain', text: text.slice(pos, s.end), start: pos, end: s.end, response });
      continue;
    }
    const seg: LivingSegment = { kind: s.kind, text: s.text, start: s.start, end: s.end, response, ...(s.q ? { q: s.q } : {}) };
    if (s.kind === 'quantity' && s.q) {
      if (s.q.kind === 'duration' && response && fuse < 0) fuse = out.length;
      if (s.q.kind === 'force') {
        const si = quantitySI(s);
        if (!force || si > force.si) force = { i: out.length, si };
      }
    }
    out.push(seg);
  }
  if (fuse >= 0) (out[fuse] as LivingSegment).bind = 'fuse';
  if (force) (out[force.i] as LivingSegment).bind = 'force';
  return out;
}

/** SI value of a quantity segment (its unit may be inherited from the end of a range). */
export function quantitySI(s: Pick<Segment, 'q' | 'text'>): number {
  if (!s.q) return Number.NaN;
  const q = parseQuantity(`${s.q.numberText} ${s.q.unit}`).quantity;
  return q ? q.si : Number.NaN;
}

/** The SI values the bound quantities of a line hold: the fuse duration (s) and the force (N). */
export function boundValues(segs: readonly LivingSegment[]): { fuseS: number; forceN: number } {
  let fuseS = Number.NaN, forceN = Number.NaN;
  for (const s of segs) {
    if (s.bind === 'fuse') fuseS = quantitySI(s);
    else if (s.bind === 'force') forceN = quantitySI(s);
  }
  return { fuseS, forceN };
}

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * Signed lean in degrees of a body (quaternion w, x, y, z) toward the camera's right vector, measured from world
 * up (z), clamped to ±12°.
 */
export function leanDeg(qw: number, qx: number, qy: number, qz: number, rx: number, ry: number, rz: number): number {
  const zx = 2 * (qx * qz + qw * qy);
  const zy = 2 * (qy * qz - qw * qx);
  const zz = 1 - 2 * (qx * qx + qy * qy);
  const lateral = zx * rx + zy * ry + zz * rz;
  // No sideways component: no lean to show (this also keeps an upside-down body symmetric).
  if (lateral === 0) return 0;
  const d = (Math.atan2(lateral, zz) * 180) / Math.PI;
  if (!(d === d)) return 0;
  return d > LEAN_CAP_DEG ? LEAN_CAP_DEG : d < -LEAN_CAP_DEG ? -LEAN_CAP_DEG : d;
}

/** Fraction of the fuse burnt after `t` seconds of a window of `windowS` seconds. */
export function fuseFill(t: number, windowS: number): number {
  if (!(windowS > 0)) return 0;
  return clamp01(t / windowS);
}

/** Live force over the line's force, in [0, 1]. */
export function forceFraction(forceN: number, lineForceN: number): number {
  const f = Math.abs(forceN);
  if (!(f > 0)) return 0;
  if (!(lineForceN > 0)) return 1;
  return clamp01(f / lineForceN);
}

/** The signal with a negative margin whose lowest margin comes first (ties: lower margin, then name). */
export function fractureSignal(margins: Record<string, number> | undefined, at: Record<string, number> | undefined): string | undefined {
  if (!margins) return undefined;
  let best: string | undefined;
  let bt = Infinity, bm = Infinity;
  for (const name of Object.keys(margins).sort()) {
    const m = margins[name] as number;
    if (!(m < 0)) continue;
    const t = at?.[name];
    const tt = typeof t === 'number' && t === t ? t : Infinity;
    if (best === undefined || tt < bt || (tt === bt && m < bm)) { best = name; bt = tt; bm = m; }
  }
  return best;
}

/** Words a signal name's parts map to when the sentence does not use the part itself. */
const SYNONYMS: Record<string, readonly string[]> = {
  tilt: ['upright', 'level', 'vertical', 'balanced', 'standing'],
  pitch: ['upright', 'level'], roll: ['upright', 'level'], yaw: ['heading', 'straight'],
  z: ['upright', 'above', 'height', 'standing'], height: ['above', 'upright', 'height'], fall: ['upright', 'standing'],
  speed: ['speed', 'track', 'walk'], vel: ['speed', 'track'], velocity: ['speed', 'track'],
  dist: ['from', 'away', 'clear', 'least'], distance: ['from', 'away', 'clear', 'least'], separation: ['from', 'away', 'clear'],
  clearance: ['clear', 'from'], gap: ['from', 'clear'], drift: ['drift', 'sideways'], lateral: ['sideways', 'drift'],
  force: ['force', 'push'], time: ['within', 'for'],
};

export function signalParts(signal: string): string[] {
  return signal.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((p) => p.toLowerCase()).filter((p) => p.length > 0);
}

/**
 * The char span of the Response_Clause word bound to `signal`: from `signalWords`, else a word equal to a part of
 * the signal name, else a synonym of a part, else the first word of the Response_Clause.
 */
export function fractureWord(
  segs: readonly LivingSegment[], signal: string | undefined, signalWords?: Record<string, readonly string[]>,
): { start: number; end: number; text: string } | undefined {
  const words = segs.filter((s) => s.kind === 'word' && s.response);
  if (words.length === 0) return undefined;
  const pick = (cands: readonly string[] | undefined): LivingSegment | undefined => {
    if (!cands) return undefined;
    for (const c of cands) {
      const lc = c.toLowerCase();
      const w = words.find((x) => x.text.toLowerCase() === lc);
      if (w) return w;
    }
    return undefined;
  };
  let w: LivingSegment | undefined;
  if (signal !== undefined) {
    w = pick(signalWords?.[signal]);
    const parts = signalParts(signal);
    if (!w) {
      for (const p of parts) {
        if (p.length < 3) continue;
        w = words.find((x) => { const t = x.text.toLowerCase(); return t === p || (p.length >= 4 && t.startsWith(p)); });
        if (w) break;
      }
    }
    if (!w) for (const p of parts) { w = pick(SYNONYMS[p]); if (w) break; }
  }
  w ??= words[0] as LivingSegment;
  return { start: w.start, end: w.end, text: w.text };
}

/** A margin with a real minus sign (U+2212) and its unit: "−0.07 m". */
export function signedMarginText(m: number, unit: string): string {
  if (m <= -Number.MAX_VALUE) return 'diverged';
  if (!(m === m)) return 'not measured';
  const s = formatSig(m, 2).replace(/^-/, '\u2212');
  return unit ? `${s} ${unit}` : s;
}

/** The harshest point of each dimension: max when severity is up, min when down, the middle otherwise. */
export function harshestValue(d: Dimension): number {
  if (d.severity === 'up') return d.max;
  if (d.severity === 'down') return d.min;
  return (d.min + d.max) / 2;
}

export function harshestScenario(space: ScenarioSpace): Scenario {
  const out: Scenario = {};
  for (const d of space.dims) out[d.name] = harshestValue(d);
  return out;
}

