import type { Clause } from './ast.js';
import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import { closestTemplate } from './editDistance.js';
import { duplicateRangeDiagnostic, parseRangePhrase, type RangePhrase } from './ranges.js';
import type {
  CompiledTemplate, Dimension, Kind, Lexicon, PerturbationTemplate, PredicateTemplate, Quantity,
  SlotKind, TemporalWrapper, Token,
} from './types.js';
import { quantityFromTokens } from './units.js';

/** A template slot. `rangeKind` is set for `{range:<kind>}`. */
export interface MatcherSlot { slot: SlotKind; name: string; rangeKind?: Kind }

/** CompiledTemplate whose slots may carry a range kind. Assignable to CompiledTemplate. */
export interface MatcherTemplate extends CompiledTemplate {
  pattern: (string | MatcherSlot)[];
}

export type SlotValue = Quantity | [Quantity, Quantity] | string;

export interface BoundClause<T> {
  template: T;
  /**
   * Bound slots by name. A plain slot is named after its kind (`force`, `length`); a repeated kind
   * gets a numeric suffix from 2 (`length2`). `{range:force}` is named `force` and holds the
   * [min, max] pair. `{direction}` and `{phase}` hold the phrase as written (lower case) or,
   * for `{direction}`, an angle Quantity.
   */
  slots: Record<string, SlotValue>;
  /** SI numbers by slot name. A range or phrase slot adds `<name>.min` and `<name>.max`. */
  si: Record<string, number>;
  ranges: Record<string, RangePhrase>;
  /** Result of the template's `dims` called with `slots`, when the template has one. */
  dimensions?: Dimension[];
}

export interface PerturbationMatch { bound?: BoundClause<PerturbationTemplate>; diagnostics: Diagnostic[] }
export interface PredicateMatch {
  bound?: BoundClause<PredicateTemplate>;
  wrapper?: TemporalWrapper;
  diagnostics: Diagnostic[];
}

const KINDS: readonly Kind[] = [
  'force', 'duration', 'length', 'speed', 'angle', 'mass', 'ratio', 'count', 'phase',
];
const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);

/**
 * Compiles a phrase to a token pattern. Words are lower-cased literals. `{kind}`, `{direction}`
 * and `{range:<kind>}` are slots. Throws on a malformed slot (a Lexicon authoring error).
 */
export function compileTemplate(phrase: string, index: number): MatcherTemplate {
  const used = new Map<string, number>();
  const pattern: (string | MatcherSlot)[] = [];
  for (const w of phrase.trim().split(/\s+/).filter((x) => x.length > 0)) {
    const m = /^\{([^{}]*)\}$/.exec(w);
    if (!m) {
      if (/[{}]/.test(w)) throw new Error(`Malformed slot '${w}' in phrase "${phrase}"`);
      pattern.push(w.toLowerCase());
      continue;
    }
    const body = m[1]!;
    let el: MatcherSlot;
    let base: string;
    if (body.startsWith('range:')) {
      const k = body.slice(6);
      if (!isKind(k)) throw new Error(`Unknown range kind '${k}' in phrase "${phrase}"`);
      base = k;
      el = { slot: 'range', name: '', rangeKind: k };
    } else if (body === 'direction' || isKind(body)) {
      base = body;
      el = { slot: body as SlotKind, name: '' };
    } else {
      throw new Error(`Unknown slot '{${body}}' in phrase "${phrase}"`);
    }
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    el.name = n === 1 ? base : base + n;
    pattern.push(el);
  }
  return { phrase, pattern, index };
}

interface Compiled { perturbations: MatcherTemplate[]; predicates: MatcherTemplate[] }
const CACHE = new WeakMap<Lexicon, Compiled>();

/** Templates of a Lexicon compiled once per Lexicon object. */
export function compiledTemplates(lexicon: Lexicon): Compiled {
  let c = CACHE.get(lexicon);
  if (!c) {
    c = {
      perturbations: lexicon.perturbations.map((t, i) => compileTemplate(t.phrase, i)),
      predicates: lexicon.predicates.map((t, i) => compileTemplate(t.phrase, i)),
    };
    CACHE.set(lexicon, c);
  }
  return c;
}

// ---------- matching one template ----------

interface Binding {
  slots: Record<string, SlotValue>;
  si: Record<string, number>;
  ranges: Record<string, RangePhrase>;
}
interface Fail { pos: number; diagnostics?: Diagnostic[] }
type Attempt = { ok: true; binding: Binding } | { ok: false; fail: Fail };

const lower = (t: Token | undefined): string => (t === undefined ? '' : t.text.toLowerCase());
const isWordTok = (t: Token | undefined, w: string): boolean =>
  t !== undefined && t.type === 'word' && lower(t) === w;
const posOf = (a: Token, b: Token = a) => ({ start: a.start, end: b.end, line: a.line, column: a.column });

function mismatch(expected: string, found: string, text: string, a: Token, b: Token): Diagnostic {
  return makeDiagnostic(
    'UNKNOWN_PHRASE',
    `Expected a ${expected} but found a ${found} ('${text}')`,
    posOf(a, b),
  );
}

function quantitySlot(
  name: string, expected: Kind, toks: readonly Token[], i: number, nextLit: string | undefined, b: Binding,
): { next: number } | { fail: Fail } {
  const tok = toks[i];
  if (tok === undefined || tok.type !== 'number') return { fail: { pos: i } };
  const nx = toks[i + 1];
  let unit: Token | undefined;
  if (nx !== undefined && nx.type === 'unit') unit = nx;
  else if (
    nx !== undefined && nx.type === 'word' && expected !== 'count' && expected !== 'ratio' &&
    lower(nx) !== nextLit
  ) unit = nx;
  const r = quantityFromTokens(tok, unit, expected);
  if (!r.quantity) return { fail: { pos: i, diagnostics: r.diagnostics } };
  const last = unit ?? tok;
  if (r.quantity.kind !== expected) {
    return {
      fail: {
        pos: i,
        diagnostics: [mismatch(expected, r.quantity.kind, r.quantity.text, tok, last)],
      },
    };
  }
  b.slots[name] = r.quantity;
  b.si[name] = r.quantity.si;
  return { next: i + (unit ? 2 : 1) };
}

function rangeSlot(
  el: MatcherSlot, toks: readonly Token[], i: number, nextEl: string | MatcherSlot | undefined, b: Binding,
): { next: number } | { fail: Fail } {
  const expected = el.rangeKind!;
  const r = parseRangePhrase(toks, i);
  if (r.diagnostics.length > 0) return { fail: { pos: i, diagnostics: r.diagnostics } };
  const range = r.range;
  if (range === undefined) return { fail: { pos: i } };
  if (range.kind !== expected) {
    return {
      fail: {
        pos: i,
        diagnostics: [mismatch(expected, range.kind, range.text, toks[i]!, toks[r.next - 1]!)],
      },
    };
  }
  // A second range for the same slot (Requirement 4.10).
  if (nextEl === undefined || typeof nextEl === 'string') {
    const after = toks[r.next];
    if (after !== undefined && (nextEl === undefined || lower(after) !== nextEl)) {
      const second = parseRangePhrase(toks, r.next);
      if (second.range !== undefined && second.range.kind === expected) {
        return { fail: { pos: r.next, diagnostics: [duplicateRangeDiagnostic(el.name, second.range)] } };
      }
    }
  }
  const q = (si: number): Quantity => ({ kind: range.kind, si, text: range.text });
  b.slots[el.name] = [q(range.min), q(range.max)];
  b.si[`${el.name}.min`] = range.min;
  b.si[`${el.name}.max`] = range.max;
  b.ranges[el.name] = range;
  return { next: r.next };
}

/** `{direction}` follows `from` and `{phase}` follows `at`: the range parser reads the lead word too. */
function phraseSlot(
  el: MatcherSlot, toks: readonly Token[], i: number, nextLit: string | undefined, b: Binding,
): { next: number } | { fail: Fail } {
  const isDir = el.slot === 'direction';
  const lead = toks[i - 1];
  if (isWordTok(lead, isDir ? 'from' : 'at')) {
    const r = parseRangePhrase(toks, i - 1);
    if (r.range !== undefined && r.next > i && r.range.kind === (isDir ? 'angle' : 'phase')) {
      b.slots[el.name] = toks.slice(i, r.next).map(lower).join(' ');
      b.si[`${el.name}.min`] = r.range.min;
      b.si[`${el.name}.max`] = r.range.max;
      b.ranges[el.name] = r.range;
      return { next: r.next };
    }
  }
  if (isDir) return quantitySlot(el.name, 'angle', toks, i, nextLit, b);
  return { fail: { pos: i } };
}

function matchOne(t: MatcherTemplate, toks: readonly Token[]): Attempt {
  const b: Binding = { slots: {}, si: {}, ranges: {} };
  let i = 0;
  for (let p = 0; p < t.pattern.length; p++) {
    const el = t.pattern[p]!;
    if (typeof el === 'string') {
      if (lower(toks[i]) !== el) return { ok: false, fail: { pos: i } };
      i++;
      continue;
    }
    const nextEl = t.pattern[p + 1];
    const nextLit = typeof nextEl === 'string' ? nextEl : undefined;
    let r: { next: number } | { fail: Fail };
    if (el.slot === 'range') r = rangeSlot(el, toks, i, nextEl, b);
    else if (el.slot === 'direction' || el.slot === 'phase') r = phraseSlot(el, toks, i, nextLit, b);
    else r = quantitySlot(el.name, el.slot as Kind, toks, i, nextLit, b);
    if ('fail' in r) return { ok: false, fail: r.fail };
    i = r.next;
  }
  if (i < toks.length) return { ok: false, fail: { pos: i } };
  return { ok: true, binding: b };
}

// ---------- temporal wrapper ----------

interface Stripped { rest: Token[]; wrapper?: TemporalWrapper; diagnostics: Diagnostic[] }

/** Strips a trailing `for <duration>` or `within <duration>`. Undefined when there is none. */
function stripWrapper(toks: readonly Token[]): Stripped | undefined {
  const n = toks.length;
  let num: Token | undefined;
  let unit: Token | undefined;
  let kw: Token | undefined;
  if (n >= 3 && toks[n - 1]!.type === 'unit' && toks[n - 2]!.type === 'number') {
    num = toks[n - 2]; unit = toks[n - 1]; kw = toks[n - 3];
  } else if (n >= 2 && toks[n - 1]!.type === 'number') {
    num = toks[n - 1]; kw = toks[n - 2];
  }
  if (num === undefined || kw === undefined) return undefined;
  const isFor = isWordTok(kw, 'for');
  if (!isFor && !isWordTok(kw, 'within')) return undefined;
  const rest = toks.slice(0, toks.indexOf(kw));
  if (rest.length === 0) return undefined;
  const r = quantityFromTokens(num, unit, 'duration');
  if (!r.quantity) return { rest, diagnostics: r.diagnostics };
  if (r.quantity.kind !== 'duration') return undefined;
  const d = r.quantity.si;
  return { rest, wrapper: isFor ? { kind: 'always', duration: d } : { kind: 'eventually', duration: d }, diagnostics: [] };
}

/** A template ending in `for {duration}` or `within {duration}` carries its own wrapper. */
function ownWrapper(t: MatcherTemplate, b: Binding): TemporalWrapper | undefined {
  const n = t.pattern.length;
  if (n < 2) return undefined;
  const lead = t.pattern[n - 2];
  const last = t.pattern[n - 1];
  if (typeof lead !== 'string' || typeof last === 'string' || last!.slot !== 'duration') return undefined;
  const d = b.si[last!.name];
  if (d === undefined) return undefined;
  if (lead === 'for') return { kind: 'always', duration: d };
  if (lead === 'within') return { kind: 'eventually', duration: d };
  return undefined;
}

// ---------- clause matching ----------

type Class = 'perturbation' | 'predicate';

interface Outcome<T> {
  bound?: BoundClause<T>;
  wrapper?: TemporalWrapper;
  diagnostics: Diagnostic[];
}

function endPosition(toks: readonly Token[], clause: Clause) {
  const last = toks[toks.length - 1];
  if (last === undefined) return { start: clause.span.start, end: clause.span.start, line: clause.span.line, column: clause.span.column };
  return { start: last.end, end: last.end, line: last.line, column: last.column + (last.end - last.start) };
}

function run<T extends { phrase: string; dims?: (slots: Record<string, SlotValue>) => Dimension[] }>(
  clause: Clause, cls: Class, templates: readonly T[], compiled: readonly MatcherTemplate[], allowWrapper: boolean,
): Outcome<T> {
  const toks = clause.tokens.filter((t) => t.type !== 'comma');
  if (templates.length === 0) {
    return {
      diagnostics: [
        makeDiagnostic(
          'UNKNOWN_PHRASE',
          `The Lexicon has no ${cls} template, so '${clause.text}' cannot match.`,
          { start: clause.span.start, end: clause.span.end, line: clause.span.line, column: clause.span.column },
        ),
      ],
    };
  }

  const attempt = (ts: readonly Token[]) => compiled.map((t) => matchOne(t, ts));
  const matchesOf = (as: readonly Attempt[]) => as.map((a, i) => (a.ok ? i : -1)).filter((i) => i >= 0);

  const full = attempt(toks);
  let matches = matchesOf(full);
  let used: Attempt[] = full;
  let stripped: Stripped | undefined;
  let strippedAttempts: Attempt[] | undefined;
  if (allowWrapper) {
    stripped = stripWrapper(toks);
    if (stripped) strippedAttempts = attempt(stripped.rest);
  }
  let viaWrapper = false;
  if (matches.length === 0 && strippedAttempts) {
    const sm = matchesOf(strippedAttempts);
    if (sm.length > 0) {
      matches = sm;
      used = strippedAttempts;
      viaWrapper = true;
    }
  }

  if (matches.length >= 2) {
    const list = matches.map((i) => `"${templates[i]!.phrase}"`).join(', ');
    return {
      diagnostics: [
        makeDiagnostic(
          'UNKNOWN_PHRASE',
          `Ambiguous phrase '${clause.text}' matches ${matches.length} ${cls} templates: ${list}.`,
          { start: clause.span.start, end: clause.span.end, line: clause.span.line, column: clause.span.column },
        ),
      ],
    };
  }

  if (matches.length === 1) {
    if (viaWrapper && stripped!.diagnostics.length > 0) return { diagnostics: stripped!.diagnostics };
    const idx = matches[0]!;
    const a = used[idx]! as { ok: true; binding: Binding };
    const template = templates[idx]!;
    const bound: BoundClause<T> = {
      template, slots: a.binding.slots, si: a.binding.si, ranges: a.binding.ranges,
    };
    if (typeof template.dims === 'function') bound.dimensions = template.dims(a.binding.slots);
    const out: Outcome<T> = { bound, diagnostics: [] };
    const w = viaWrapper ? stripped!.wrapper : allowWrapper ? ownWrapper(compiled[idx]!, a.binding) : undefined;
    if (w) out.wrapper = w;
    return out;
  }

  // No match: report at the furthest point any template reached.
  const fails: Fail[] = [];
  if (strippedAttempts) for (const a of strippedAttempts) if (!a.ok) fails.push(a.fail);
  for (const a of full) if (!a.ok) fails.push(a.fail);
  let best = fails[0]!;
  for (const f of fails) if (f.pos > best.pos) best = f;

  let sugg = closestTemplate(clause.tokens, compiled);
  if (stripped) {
    const alt = closestTemplate(stripped.rest, compiled);
    if (alt.distance <= sugg.distance) sugg = alt;
  }
  const hint = sugg.template !== undefined && !sugg.tooFar ? sugg.template.phrase : undefined;
  const decorate = (d: Diagnostic): Diagnostic => {
    if (d.kind !== 'UNKNOWN_PHRASE') return d;
    const message = hint !== undefined
      ? `${d.message}. Did you mean "${hint}"?`
      : `${d.message}. No close phrase exists.`;
    return makeDiagnostic(d.kind, message, d, hint !== undefined ? { suggestion: hint } : {});
  };

  if (best.diagnostics && best.diagnostics.length > 0) {
    return { diagnostics: best.diagnostics.map(decorate) };
  }
  const tok = toks[best.pos];
  const generic = tok !== undefined
    ? makeDiagnostic('UNKNOWN_PHRASE', `'${tok.text}' does not continue any ${cls} phrase`, posOf(tok))
    : makeDiagnostic(
      'UNKNOWN_PHRASE',
      `The ${cls} phrase ends early: more words are expected after '${toks[toks.length - 1]?.text ?? ''}'`,
      endPosition(toks, clause),
    );
  return { diagnostics: [decorate(generic)] };
}

/** Matches a trigger, fault or feature clause against the Lexicon's perturbation templates. */
export function matchPerturbation(clause: Clause, lexicon: Lexicon): PerturbationMatch {
  const r = run(clause, 'perturbation', lexicon.perturbations, compiledTemplates(lexicon).perturbations, false);
  const out: PerturbationMatch = { diagnostics: r.diagnostics };
  if (r.bound) out.bound = r.bound;
  return out;
}

/** Matches a response or state clause against the predicate templates, stripping `for`/`within <duration>`. */
export function matchPredicate(clause: Clause, lexicon: Lexicon): PredicateMatch {
  const r = run(clause, 'predicate', lexicon.predicates, compiledTemplates(lexicon).predicates, true);
  const out: PredicateMatch = { diagnostics: r.diagnostics };
  if (r.bound) out.bound = r.bound;
  if (r.wrapper) out.wrapper = r.wrapper;
  return out;
}
