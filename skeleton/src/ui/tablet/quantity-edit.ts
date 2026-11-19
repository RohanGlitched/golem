// Quantity stepping, dragging, rewriting and typed commits. Pure.
import { fromSI, parseQuantity } from '../../ears/index.js';
import { decimalsOf, roundTo } from '../core/format.js';
import { effectiveStep, rangeOf } from '../core/units-ui.js';
import type { Modifier, Range } from '../core/units-ui.js';
import type { QuantityInfo } from './segments.js';

export { effectiveStep, rangeOf };
export type { Modifier, Range };

const clamp = (x: number, r: Range): number => (x < r.min ? r.min : x > r.max ? r.max : x);

export const stepDecimals = (unit: string, mod: Modifier, writtenDecimals: number): number =>
  Math.max(decimalsOf(effectiveStep(unit, mod)), writtenDecimals);

export function stepQuantity(v: number, unit: string, dir: 1 | -1, mod: Modifier, range: Range, writtenDecimals: number): number {
  const d = stepDecimals(unit, mod, writtenDecimals);
  return clamp(roundTo(v + dir * effectiveStep(unit, mod), d), range);
}

/** One step per 4 px of horizontal drag, counted from the value at drag start. */
export function dragQuantity(startValue: number, dxPx: number, unit: string, mod: Modifier, range: Range, writtenDecimals: number): number {
  const d = stepDecimals(unit, mod, writtenDecimals);
  const steps = Math.trunc(dxPx / 4);
  return clamp(roundTo(startValue + steps * effectiveStep(unit, mod), d), range);
}

export function rewriteSpan(text: string, start: number, end: number, newSpan: string): string {
  return text.slice(0, start) + newSpan + text.slice(end);
}

/** The new span text, with the same unit and gap as written. */
export function formatSpan(info: QuantityInfo, value: number, decimals: number): string {
  const d = Math.min(Math.max(0, decimals), 15);
  const num = roundTo(value, d).toFixed(d);
  return info.inheritedUnit ? num : num + info.gap + info.unit;
}

const article = (kind: string): string => (/^[aeiou]/.test(kind) ? 'an' : 'a');

export function commitTyped(
  typed: string, info: QuantityInfo, range: Range,
): { ok: true; value: number; clamped: boolean } | { ok: false; message: string } {
  const t = typed.trim();
  const bare = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t);
  const text = bare ? `${t}${info.gap === '' && info.unit !== '%' ? ' ' : info.gap}${info.unit}` : t;
  const numMatch = /^[+-]?\d+(?:\.\d+)?/.exec(t);
  const example = `${numMatch ? numMatch[0] : String(info.value)} ${info.unit}`;
  const wrong = { ok: false as const, message: `Write ${article(info.kind)} ${info.kind}: ${example}, not ${t || 'an empty value'}` };
  if (t === '') return wrong;
  const q = parseQuantity(text).quantity;
  if (!q || q.kind !== info.kind) return wrong;
  const v = fromSI(q.si, info.unit);
  if (!Number.isFinite(v)) return wrong;
  const c = clamp(v, range);
  return { ok: true, value: c, clamped: c !== v };
}
