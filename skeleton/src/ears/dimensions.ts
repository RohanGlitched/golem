// Builds the scenario Dimensions and PerturbationCall params of one matched template.
// New contract: the template declares `slots` (dimension name and severity per slot) and the
// Dimensions come from the ranges written in the line. Deprecated contract: the template's
// `dims()` returns them, and each is tied back to a slot so that no parameter is lost.
import type { Clause } from './ast.js';
import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import type { BoundClause, MatcherSlot } from './matcher.js';
import type {
  Dimension, LegacyDims, SlotDimension, SlotRange, Span,
} from './types.js';

interface DimensionTemplate { phrase: string; slots?: Record<string, SlotDimension>; dims?: LegacyDims }

export interface BuiltDimensions {
  dims: Dimension[];
  /** Parallel to `dims`: the source span of the slot each Dimension came from. */
  sources: (Span | undefined)[];
  /** Slot name → Dimension name (searched) or SI value (fixed). */
  params: Record<string, string | number>;
  diagnostics: Diagnostic[];
}

/** Numbers in messages: up to 6 significant digits, no trailing zeros. */
export function fmt(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x);
}

interface SlotInfo { name: string; range: SlotRange; span: Span | undefined; text: string }

function slotInfos<T>(bound: BoundClause<T>): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const el of bound.compiled.pattern) {
    if (typeof el === 'string') continue;
    const name = (el as MatcherSlot).name;
    const r = bound.ranges[name];
    if (r) {
      out.push({ name, range: { kind: r.kind, min: r.min, max: r.max, wrap: r.wrap }, span: r.span, text: r.text });
      continue;
    }
    const v = bound.slots[name];
    if (v !== undefined && typeof v === 'object' && !Array.isArray(v)) {
      out.push({ name, range: { kind: v.kind, min: v.si, max: v.si, wrap: false }, span: bound.spans[name], text: v.text });
    }
  }
  return out;
}

function toDimension(name: string, r: SlotRange, severity: Dimension['severity']): Dimension {
  const d: Dimension = { name, kind: r.kind, min: r.min, max: r.max, severity };
  if (r.wrap) d.wrap = true;
  return d;
}

const spanOf = (s: Span | undefined, clause: Clause): Span => s ?? clause.span;

/**
 * `perturbation` is false for predicate templates: a predicate with neither `slots` nor `dims` adds
 * no Dimension and its ranges are not searched, as before.
 */
export function buildDimensions<T extends DimensionTemplate>(
  bound: BoundClause<T>, clause: Clause, perturbation: boolean,
): BuiltDimensions {
  const template = bound.template;
  const infos = slotInfos(bound);
  const out: BuiltDimensions = { dims: [], sources: [], params: {}, diagnostics: [] };

  const undeclared = (s: SlotInfo, how: string): void => {
    out.diagnostics.push(makeDiagnostic(
      'BAD_LEXICON',
      `Slot {${s.name}} of "${template.phrase}" is searched over '${s.text}', but the Lexicon declares no dimension for it; ${how}`,
      spanOf(s.span, clause),
    ));
  };

  if (template.slots !== undefined) {
    for (const s of infos) {
      const spec = template.slots[s.name];
      if (spec) {
        out.dims.push(toDimension(spec.dim, s.range, spec.severity));
        out.sources.push(s.span);
        out.params[s.name] = s.range.min < s.range.max ? spec.dim : s.range.min;
      } else if (s.range.min < s.range.max) {
        undeclared(s, `add slots.${s.name} to the template`);
      } else {
        out.params[s.name] = s.range.min;
      }
    }
    // Hidden slots: declared with a range, named by no slot of the phrase.
    const named = new Set(bound.compiled.pattern.flatMap((el) => (typeof el === 'string' ? [] : [(el as MatcherSlot).name])));
    for (const [slot, spec] of Object.entries(template.slots)) {
      if (spec.range === undefined || named.has(slot)) continue;
      const r = spec.range;
      out.dims.push(toDimension(spec.dim, { kind: r.kind, min: r.min, max: r.max, wrap: r.wrap === true }, spec.severity));
      out.sources.push(undefined);
      out.params[slot] = r.min < r.max ? spec.dim : r.min;
    }
    return out;
  }

  if (typeof template.dims !== 'function') {
    for (const s of infos) {
      if (s.range.min < s.range.max) { if (perturbation) undeclared(s, `add slots.${s.name} to the template`); }
      else out.params[s.name] = s.range.min;
    }
    return out;
  }

  // Deprecated path.
  const ranges: Record<string, SlotRange> = {};
  for (const s of infos) ranges[s.name] = { ...s.range };
  const dims = template.dims(bound.slots, ranges);
  const tie = new Map<string, number>(); // slot name → index in dims
  const taken = new Set<number>();
  const bind = (s: SlotInfo, ok: (d: Dimension) => boolean): void => {
    if (tie.has(s.name)) return;
    const k = dims.findIndex((d, i) => !taken.has(i) && ok(d));
    if (k >= 0) { tie.set(s.name, k); taken.add(k); }
  };
  for (const s of infos) bind(s, (d) => d.name === s.name);
  for (const s of infos) bind(s, (d) => d.name.endsWith('.' + s.name));
  for (const s of infos) bind(s, (d) => d.kind === s.range.kind && d.min === s.range.min && d.max === s.range.max);
  for (const s of infos) {
    const freeSlots = infos.filter((x) => !tie.has(x.name) && x.range.kind === s.range.kind);
    const freeDims = dims.filter((d, i) => !taken.has(i) && d.kind === s.range.kind);
    if (freeSlots.length === 1 && freeDims.length === 1) bind(s, (d) => d.kind === s.range.kind);
  }

  const sourceOf = new Map<number, Span | undefined>();
  for (const s of infos) {
    const k = tie.get(s.name);
    if (k === undefined) {
      if (s.range.min < s.range.max) undeclared(s, 'declare slots on the template');
      else out.params[s.name] = s.range.min;
      continue;
    }
    const d = dims[k]!;
    sourceOf.set(k, s.span);
    out.params[s.name] = d.min < d.max ? d.name : d.min;
    if (d.min !== s.range.min || d.max !== s.range.max) {
      out.diagnostics.push(makeDiagnostic(
        'BAD_LEXICON',
        `Dimension '${d.name}' of "${template.phrase}" spans [${fmt(d.min)}, ${fmt(d.max)}] but the line gives '${s.text}' ([${fmt(s.range.min)}, ${fmt(s.range.max)}] in SI) for slot {${s.name}}; declare slots on the template so the compiler builds it from the line`,
        spanOf(s.span, clause),
        { severity: 'warning' },
      ));
    }
  }
  dims.forEach((d, i) => {
    out.dims.push(d);
    out.sources.push(sourceOf.get(i));
    if (!taken.has(i) && d.min < d.max) {
      out.diagnostics.push(makeDiagnostic(
        'BAD_LEXICON',
        `Dimension '${d.name}' of "${template.phrase}" is searched but tied to no slot, so the perturbation never receives it; declare slots on the template`,
        clause.span,
        { severity: 'warning' },
      ));
    }
  });
  return out;
}
