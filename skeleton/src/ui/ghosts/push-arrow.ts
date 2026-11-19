// Push_Arrow: where and how long the arrow of a ghost's perturbation is drawn.
import type { Lexicon, PerturbationCall, PerturbationTemplate, Scenario, V3 } from '../types.js';

export interface ResolvedArrow {
  /** Body id the arrow starts at (its position in frame 0). */
  body: number;
  /** Unit direction of the force. */
  dir: V3;
  /** Metres: clamp(0.3 |F| / 100, 0.05, 0.9). */
  length: number;
  /** Ghost time (s) at which the perturbation window ends. */
  tEnd: number;
}

export const ARROW_MIN = 0.05;
export const ARROW_MAX = 0.9;
export const DEFAULT_PUSH_S = 0.2;

export function arrowLength(forceN: number): number {
  const l = (0.3 * forceN) / 100;
  return l < ARROW_MIN ? ARROW_MIN : l > ARROW_MAX ? ARROW_MAX : l;
}

/** The template a call names, by phrase or by short name. */
export function findTemplate(lexicon: Lexicon, call: PerturbationCall): PerturbationTemplate | undefined {
  return lexicon.perturbations.find((p) => p.phrase === call.template || (p as { name?: string }).name === call.template);
}

/** Resolves call params: a string is a dimension name looked up in the scenario, a number is used as written. */
export function resolveValues(call: PerturbationCall, scenario: Scenario): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(call.params)) {
    const x = typeof v === 'string' ? scenario[v] : v;
    if (typeof x === 'number') out[k] = x;
  }
  return out;
}

export function resolveArrow(
  call: PerturbationCall, tpl: PerturbationTemplate | undefined, scenario: Scenario,
  bodyId: (name: string) => number,
): ResolvedArrow | undefined {
  if (!tpl || typeof tpl.visual !== 'function') return undefined;
  const values = resolveValues(call, scenario);
  let v: ReturnType<NonNullable<PerturbationTemplate['visual']>>;
  try { v = tpl.visual(values); } catch { return undefined; }
  const f = v?.force;
  if (!f || v.at === undefined) return undefined;
  const m = Math.hypot(f[0], f[1], f[2]);
  if (!(m > 0) || !Number.isFinite(m)) return undefined;
  let body: number;
  try { body = bodyId(v.at); } catch { return undefined; }
  if (!(body >= 0)) return undefined;
  const dur = values['duration'];
  return {
    body,
    dir: [f[0] / m, f[1] / m, f[2] / m],
    length: arrowLength(m),
    tEnd: typeof dur === 'number' && dur >= 0 ? dur : DEFAULT_PUSH_S,
  };
}
