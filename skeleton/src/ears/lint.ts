// Lexicon linter: authoring checks an app runs once, before any requirement is compiled.
// Pure and deterministic: fixed sample grids, no randomness, never throws.
import type { Clause } from './ast.js';
import { compileTemplate, matchPerturbation, matchPredicate, slotForms, type MatcherSlot, type MatcherTemplate } from './matcher.js';
import { tokenize } from './tokenizer.js';
import type { Kind, Lexicon, PerturbationTemplate, PredicateTemplate } from './types.js';
import { ACCEPTED_UNITS, parseQuantity } from './units.js';

export type LintCode =
  | 'ROBOT_NAMES' | 'FEATURES' | 'MALFORMED_PHRASE' | 'UNMATCHABLE' | 'AMBIGUOUS_TEMPLATES'
  | 'UNDECLARED_SLOT' | 'UNKNOWN_SLOT' | 'DUPLICATE_DIMENSION' | 'DEPRECATED_DIMS' | 'BAD_ONSET'
  | 'NO_SIGNALS' | 'UNKNOWN_UNIT' | 'MARGIN_THROWS' | 'MARGIN_NOT_FINITE' | 'UNLISTED_SIGNAL'
  | 'SLOT_IGNORED' | 'UNIT_MISMATCH';

export interface LintFinding {
  severity: 'error' | 'warning';
  code: LintCode;
  /** The template phrase the finding is about, when there is one. */
  template?: string;
  message: string;
}

export interface LintOptions {
  /** Signal samples for the margin checks. Default: a fixed grid over -1, 0, 0.5, 1 and 2. */
  samples?: Record<string, number>[];
}

const KEYWORDS = new Set(['when', 'while', 'if', 'then', 'where', 'the', 'shall']);
const GRID = [-1, 0, 0.5, 1, 2];
/** The SI unit of a kind, for the linear-margin unit check. */
const SI_UNIT: Partial<Record<Kind, string>> = {
  force: 'N', duration: 's', length: 'm', speed: 'm/s', angle: 'rad', mass: 'kg',
};
const DELTA = 0.125;

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function slotsOf(t: MatcherTemplate): MatcherSlot[] {
  return t.pattern.filter((e): e is MatcherSlot => typeof e !== 'string');
}

/** A clause that should match `t`: each slot filled with its example form. */
function sampleClause(t: MatcherTemplate): Clause {
  const words = t.phrase.trim().split(/\s+/);
  const text = t.pattern.map((el, i) => (typeof el === 'string' ? words[i]! : slotForms(el).example)).join(' ');
  // A leading word keeps a leading number from reading as a requirement ID.
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const span = first && last
    ? { start: first.start, end: last.end, line: first.line, column: first.column }
    : { start: 2, end: 2, line: 1, column: 3 };
  return { text, tokens, span };
}

/** SI value of a slot's example, for margin calls. */
function exampleSI(el: MatcherSlot): Record<string, number> {
  const ex = slotForms(el).example.replace(/^up to /, '');
  const q = parseQuantity(ex, el.slot === 'range' ? el.rangeKind : el.slot === 'direction' ? 'angle' : el.slot);
  const v = q.quantity?.si ?? 1;
  if (el.slot === 'range') return { [`${el.name}.min`]: 0, [`${el.name}.max`]: v };
  return { [el.name]: v };
}

export function lintLexicon(lexicon: Lexicon, options: LintOptions = {}): LintFinding[] {
  const out: LintFinding[] = [];
  const add = (severity: LintFinding['severity'], code: LintCode, message: string, template?: string): void => {
    out.push(template !== undefined ? { severity, code, template, message } : { severity, code, message });
  };

  // Robot names and features.
  const names = lexicon.robotNames ?? [];
  if (names.length === 0) add('error', 'ROBOT_NAMES', 'robotNames is empty, so no line can name a robot');
  const seenNames = new Set<string>();
  for (const n of names) {
    const key = n.trim().replace(/\s+/g, ' ').toLowerCase();
    if (seenNames.has(key)) add('warning', 'ROBOT_NAMES', `Robot name '${n}' is listed more than once`);
    seenNames.add(key);
    const toks = tokenize(n);
    if (key === '' || toks.diagnostics.length > 0 || toks.tokens.some((t) => t.type !== 'word')) {
      add('error', 'ROBOT_NAMES', `Robot name '${n}' must be one or more plain words (letters, digits, _ ' -), and no keyword`);
    } else if (key.split(' ').some((w) => KEYWORDS.has(w))) {
      add('error', 'ROBOT_NAMES', `Robot name '${n}' contains an EARS keyword, so THE <robot> SHALL cannot find it`);
    }
  }
  const seenFeatures = new Set<string>();
  for (const f of lexicon.features ?? []) {
    const key = f.trim().replace(/\s+/g, ' ').toLowerCase();
    if (key === '') add('error', 'FEATURES', 'A feature name is empty');
    else if (seenFeatures.has(key)) add('warning', 'FEATURES', `Feature '${f}' is listed more than once`);
    seenFeatures.add(key);
  }

  // Templates: phrases first, then the per-class checks.
  const compileAll = <T extends { phrase: string }>(ts: readonly T[]): (MatcherTemplate | undefined)[] =>
    ts.map((t, i) => {
      try {
        return compileTemplate(t.phrase, i);
      } catch (e) {
        add('error', 'MALFORMED_PHRASE', describeError(e), t.phrase);
        return undefined;
      }
    });
  const perts = compileAll(lexicon.perturbations ?? []);
  const preds = compileAll(lexicon.predicates ?? []);
  // The matcher compiles phrases itself, so it can only run when every phrase compiles.
  const matchable = perts.every((x) => x) && preds.every((x) => x);

  (lexicon.perturbations ?? []).forEach((t, i) => {
    const ct = perts[i];
    if (!ct) return;
    lintSlots(t, ct, true, add);
    if (t.maxOnset !== undefined && !(Number.isFinite(t.maxOnset) && t.maxOnset >= 0)) {
      add('error', 'BAD_ONSET', `maxOnset must be a finite number of seconds >= 0, found ${String(t.maxOnset)}`, t.phrase);
    }
  });
  (lexicon.predicates ?? []).forEach((t, i) => {
    const ct = preds[i];
    if (!ct) return;
    lintSlots(t, ct, false, add);
    lintMargin(t, ct, options.samples, add);
  });

  if (matchable) {
    lintMatching(lexicon, 'perturbation', perts as MatcherTemplate[], add);
    lintMatching(lexicon, 'predicate', preds as MatcherTemplate[], add);
  }
  return out;
}

type Add = (severity: LintFinding['severity'], code: LintCode, message: string, template?: string) => void;

function lintSlots(
  t: PerturbationTemplate | PredicateTemplate, ct: MatcherTemplate, perturbation: boolean, add: Add,
): void {
  const slots = slotsOf(ct);
  const declared = t.slots;
  if (declared === undefined && typeof t.dims === 'function') {
    add('warning', 'DEPRECATED_DIMS', 'Uses the deprecated dims(); declare slots so the compiler builds the Dimensions from the line', t.phrase);
    return;
  }
  if (declared === undefined && !perturbation) return;
  const decl = declared ?? {};
  const names = new Set(slots.map((s) => s.name));
  for (const [key, spec] of Object.entries(decl)) {
    const r = spec.range;
    if (r !== undefined) {
      if (names.has(key)) {
        add('warning', 'SLOT_IGNORED', `slots.${key} gives a range, but the phrase has a slot of that name, so the range written in the line is used`, t.phrase);
      } else if (!(Number.isFinite(r.min) && Number.isFinite(r.max) && r.min <= r.max)) {
        add('error', 'UNKNOWN_SLOT', `slots.${key}.range must have finite bounds with min <= max, found [${String(r.min)}, ${String(r.max)}]`, t.phrase);
      }
      continue;
    }
    if (!names.has(key)) {
      add('error', 'UNKNOWN_SLOT', `slots.${key} names no slot of the phrase; its slots are ${[...names].map((n) => `'${n}'`).join(', ') || 'none'}`, t.phrase);
    }
  }
  if (perturbation) {
    for (const s of slots) {
      if ((s.slot === 'range' || s.slot === 'direction' || s.slot === 'phase') && decl[s.name] === undefined) {
        add('error', 'UNDECLARED_SLOT', `Slot '${s.name}' can hold a searched range but slots.${s.name} is not declared, so a line that gives a range there does not compile`, t.phrase);
      }
    }
  }
  const byDim = new Map<string, string>();
  for (const [slot, spec] of Object.entries(decl)) {
    const other = byDim.get(spec.dim);
    if (other !== undefined) add('error', 'DUPLICATE_DIMENSION', `slots.${other} and slots.${slot} both declare dimension '${spec.dim}'`, t.phrase);
    else byDim.set(spec.dim, slot);
  }
}

function lintMargin(
  t: PredicateTemplate, ct: MatcherTemplate, samples: Record<string, number>[] | undefined, add: Add,
): void {
  const signals = t.signals ?? [];
  if (signals.length === 0) add('warning', 'NO_SIGNALS', 'Lists no signals, so its margin can only depend on slot values', t.phrase);
  if (!(ACCEPTED_UNITS as readonly string[]).includes(t.unit)) {
    add('warning', 'UNKNOWN_UNIT', `Unit '${t.unit}' is not an accepted unit (${ACCEPTED_UNITS.join(', ')})`, t.phrase);
  }
  const grid: Record<string, number>[] = samples ?? GRID.map((_, k) => {
    const s: Record<string, number> = {};
    signals.forEach((name, j) => { s[name] = GRID[(k + j) % GRID.length]!; });
    return s;
  });
  const slots = slotsOf(ct);
  const base: Record<string, number> = {};
  for (const s of slots) Object.assign(base, exampleSI(s));

  const unlisted = new Set<string>();
  const call = (s: Record<string, number>, k: Record<string, number>): number | Error => {
    const listed = new Set(signals);
    const view = new Proxy({ ...s }, {
      get(target, prop, recv) {
        if (typeof prop === 'string' && !listed.has(prop) && !(prop in Object.prototype)) unlisted.add(prop);
        return Reflect.get(target, prop, recv);
      },
    });
    try {
      return t.margin(view, { ...k });
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };

  const values: number[] = [];
  for (const s of grid) {
    const m = call(s, base);
    if (m instanceof Error) {
      add('error', 'MARGIN_THROWS', `margin throws on sampled signals ${JSON.stringify(s)}: ${m.message}`, t.phrase);
      return;
    }
    values.push(m);
  }
  if (unlisted.size > 0) {
    add('error', 'UNLISTED_SIGNAL', `margin reads ${[...unlisted].map((n) => `'${n}'`).join(', ')}, which signals does not list, so the monitor never passes it`, t.phrase);
  }
  const bad = values.filter((v) => !Number.isFinite(v));
  if (bad.length > 0) {
    add('warning', 'MARGIN_NOT_FINITE', `margin returns ${bad.map(String).join(', ')} on ${bad.length} of ${values.length} sampled signal sets`, t.phrase);
  }

  // Slot sensitivity and units: a margin linear in a slot with slope ±1 is in that slot's unit.
  for (const s of slots) {
    if (s.slot === 'range') continue;
    const key = s.name;
    const kind: Kind = s.slot === 'direction' ? 'angle' : (s.slot as Kind);
    let same = true;
    let linear = true;
    for (let i = 0; i < grid.length; i++) {
      const v0 = values[i]!;
      const v1 = call(grid[i]!, { ...base, [key]: base[key]! + DELTA });
      if (v1 instanceof Error || !Number.isFinite(v0) || !Number.isFinite(v1)) { same = false; linear = false; break; }
      if (v1 !== v0) same = false;
      if (Math.abs(Math.abs(v1 - v0) - DELTA) > 1e-9) linear = false;
    }
    if (same) {
      add('warning', 'SLOT_IGNORED', `margin does not change when slot '${key}' changes, so the value written there has no effect`, t.phrase);
      continue;
    }
    const si = SI_UNIT[kind];
    if (linear && si !== undefined && t.unit !== si) {
      add('warning', 'UNIT_MISMATCH', `margin moves 1:1 with slot '${key}' (a ${kind}, SI unit ${si}), but unit is '${t.unit}'`, t.phrase);
    }
  }
}

function lintMatching(lexicon: Lexicon, cls: 'perturbation' | 'predicate', cts: MatcherTemplate[], add: Add): void {
  const reported = new Set<string>();
  cts.forEach((ct) => {
    const clause = sampleClause(ct);
    const m = cls === 'perturbation' ? matchPerturbation(clause, lexicon) : matchPredicate(clause, lexicon);
    const amb = m.diagnostics.find((d) => d.message.startsWith('Ambiguous'));
    if (amb) {
      const others = cts.filter((o) => o !== ct && amb.message.includes(`"${o.phrase}"`)).map((o) => o.phrase);
      const key = [ct.phrase, ...others].sort().join('\u0000');
      if (!reported.has(key)) {
        reported.add(key);
        add('error', 'AMBIGUOUS_TEMPLATES', `The sample clause '${clause.text}' matches ${others.length + 1} ${cls} templates: ${[ct.phrase, ...others].map((p) => `"${p}"`).join(', ')}`, ct.phrase);
      }
      return;
    }
    if (!m.bound || m.bound.template.phrase !== ct.phrase) {
      add('error', 'UNMATCHABLE', `The sample clause '${clause.text}' does not match its own template: ${m.diagnostics.map((d) => d.message).join('; ')}`, ct.phrase);
    }
  });
}
