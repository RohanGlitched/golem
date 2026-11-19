// Compiler: tokenizer -> parser -> matcher -> monitor builder -> CompiledRequirement.
// Pure: no clock, no randomness, no I/O.
import type { Clause } from './ast.js';
import { hasError, makeDiagnostic, sortDiagnostics, type Diagnostic } from './diagnostics.js';
import { extractCriteria, type RawCriterion } from './extract.js';
import { matchPerturbation, matchPredicate, type BoundClause } from './matcher.js';
import { buildDimensions } from './dimensions.js';
import { tokenEditDistance } from './editDistance.js';
import { formulaOf, type FormulaInput } from './formula.js';
import { buildMonitor } from './monitor.js';
import { parse } from './parser.js';
import { kiroText, tokenize } from './tokenizer.js';
import type {
  CompileOptions, CompiledRequirement, Dimension, Lexicon, PerturbationCall, PerturbationTemplate,
  PredicateTemplate, Span, TemporalWrapper,
} from './types.js';

export interface CompileResult {
  requirement?: CompiledRequirement;
  diagnostics: Diagnostic[];
}

/** Default episode length in seconds when neither the options nor the Lexicon give one. */
export const DEFAULT_EPISODE_SECONDS = 10;

const normaliseFeature = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();


/**
 * Matches a WHILE state against both template classes. Exactly one match wins. Two matches are
 * ambiguous. With none, the diagnostics of the class that matched further into the clause are kept
 * (the predicate class on a tie, or when the Lexicon has no perturbation template).
 */
function matchState(condition: Clause, lexicon: Lexicon): {
  predicate?: BoundClause<PredicateTemplate>; perturbation?: BoundClause<PerturbationTemplate>; diagnostics: Diagnostic[];
} {
  const mp = matchPredicate(condition, lexicon);
  if (lexicon.perturbations.length === 0) return { ...(mp.bound ? { predicate: mp.bound } : {}), diagnostics: mp.diagnostics };
  const mt = matchPerturbation(condition, lexicon);
  if (mp.bound && mt.bound) {
    return {
      diagnostics: [makeDiagnostic(
        'UNKNOWN_PHRASE',
        `Ambiguous state '${condition.text}' matches the predicate "${mp.bound.template.phrase}" and the perturbation "${mt.bound.template.phrase}".`,
        condition.span,
      )],
    };
  }
  if (mp.bound) return { predicate: mp.bound, diagnostics: mp.diagnostics };
  if (mt.bound) return { perturbation: mt.bound, diagnostics: mt.diagnostics };
  if (lexicon.predicates.length === 0) return { diagnostics: mt.diagnostics };
  const reach = (d: readonly Diagnostic[]): number => d.find((x) => x.severity === 'error')?.start ?? -1;
  return { diagnostics: reach(mt.diagnostics) > reach(mp.diagnostics) ? mt.diagnostics : mp.diagnostics };
}

/** UNKNOWN_PHRASE when `wanted` (normalised) is not a declared feature, with the closest one. */
function featureDiagnostic(condition: Clause, wanted: string, features: readonly string[]): Diagnostic | undefined {
  const pos = condition.span;
  if (features.length === 0) {
    return makeDiagnostic('UNKNOWN_PHRASE', `The Lexicon declares no features, so '${condition.text}' cannot match.`, pos);
  }
  if (features.some((f) => normaliseFeature(f) === wanted)) return undefined;
  const words = (s: string) => normaliseFeature(s).split(' ').map((w) => ({ word: w }));
  const a = words(wanted);
  let best: string | undefined;
  let bestD = Infinity;
  let bestLen = 0;
  for (const f of features) {
    const b = words(f);
    const d = tokenEditDistance(a, b);
    if (d < bestD) { best = f; bestD = d; bestLen = Math.max(a.length, b.length); }
  }
  const close = best !== undefined && bestD <= bestLen / 2;
  const hint = close ? ` Did you mean "${best}"?` : '';
  return makeDiagnostic(
    'UNKNOWN_PHRASE',
    `Unknown feature '${condition.text}'.${hint} Declared features: ${features.join(', ')}`,
    pos,
    close ? { suggestion: best! } : {},
  );
}

/**
 * Seconds of simulation after warm-up a requirement needs.
 * - Event/unwanted: `for d` → onset + trigger duration + d; `within T` → onset + trigger duration + 2T
 *   (the deadline plus at least T of hold); no wrapper → the episode.
 * - Ubiquitous, optional, perturbation state: `for d` → onset + d; `within T` → max(episode,
 *   onset + 2T); no wrapper → the episode.
 * - Predicate state: the episode (it is checked at every instant).
 */
function horizonOf(
  timed: boolean, predicateState: boolean, wrapper: TemporalWrapper, onset: number, triggerDur: number, episode: number,
): number {
  if (predicateState || wrapper.duration === undefined) return episode;
  const d = wrapper.duration;
  if (timed) return onset + triggerDur + (wrapper.kind === 'eventually' ? 2 * d : d);
  return wrapper.kind === 'eventually' ? Math.max(episode, onset + 2 * d) : onset + d;
}

/** Duration the trigger itself lasts (fixed value, or the top of a range), or 0. */
function triggerDuration(bound: BoundClause<PerturbationTemplate>): number {
  const d = bound.si['duration'] ?? bound.si['duration.max'];
  return d !== undefined && Number.isFinite(d) ? d : 0;
}

/** Reports the second occurrence of a repeated Dimension name. */
function duplicateDimensions(
  dims: readonly Dimension[], sources: readonly (Span | undefined)[], clause: Clause | undefined,
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  dims.forEach((d, i) => {
    if (!seen.has(d.name)) { seen.add(d.name); return; }
    const span = sources[i] ?? clause?.span;
    out.push(makeDiagnostic(
      'BAD_RANGE',
      `Duplicate dimension '${d.name}': a scenario space may name each dimension once`,
      span ?? { start: 0, end: 0, line: 1, column: 1 },
    ));
  });
  return out;
}

export interface FileCompileResult {
  /** File order. */
  requirements: CompiledRequirement[];
  /** Extractor and compiler diagnostics, in file coordinates, ascending by start. */
  diagnostics: Diagnostic[];
}

/** Maps an offset inside a criterion's joined text to file coordinates. */
function toFilePosition(
  crit: RawCriterion, index: number,
): { offset: number; line: number; column: number } {
  const segs = crit.segments;
  let seg = segs[0]!;
  for (const s of segs) {
    if (s.textIndex <= index) seg = s; else break;
  }
  // An index in the joining space (or past the end) clamps to the end of its segment.
  const within = Math.min(Math.max(0, index - seg.textIndex), seg.length);
  return { offset: seg.offset + within, line: seg.line, column: seg.column + within };
}

function remapDiagnostic(crit: RawCriterion, d: Diagnostic): Diagnostic {
  const from = toFilePosition(crit, d.start);
  let end = from.offset;
  if (d.end > d.start) end = toFilePosition(crit, d.end - 1).offset + 1;
  const out: Diagnostic = { ...d, start: from.offset, end: Math.max(from.offset, end), line: from.line, column: from.column };
  return out;
}

/**
 * Compiles every EARS criterion of a Kiro requirements.md. Each criterion is
 * compiled on its own, so an invalid one never hides a valid one. Diagnostics
 * are reported in file coordinates.
 */
export function compileRequirementsFile(
  text: string, lexicon: Lexicon, options: CompileOptions = {},
): FileCompileResult {
  const ex = extractCriteria(text);
  const requirements: CompiledRequirement[] = [];
  const diagnostics: Diagnostic[] = [...ex.diagnostics];
  const seenIds = new Set<string>();

  for (const crit of ex.criteria) {
    if (seenIds.has(crit.id)) {
      diagnostics.push(makeDiagnostic(
        'NON_EARS_LINE',
        `Requirement ID ${crit.id} is used more than once; both criteria are kept.`,
        { start: crit.offset, end: crit.offset + crit.text.length, line: crit.line, column: crit.column },
        { severity: 'warning' },
      ));
    }
    seenIds.add(crit.id);

    const r = compileRequirement(crit.text, lexicon, { ...options, id: crit.id });
    for (const d of r.diagnostics) diagnostics.push(remapDiagnostic(crit, d));
    if (r.requirement) requirements.push(r.requirement);
  }
  return { requirements, diagnostics: sortDiagnostics(diagnostics) };
}

export function compileRequirement(
  line: string, lexicon: Lexicon, options: CompileOptions = {},
): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const finish = (requirement?: CompiledRequirement): CompileResult => {
    const sorted = sortDiagnostics(diagnostics);
    if (hasError(sorted) || !requirement) return { diagnostics: sorted };
    return { requirement, diagnostics: sorted };
  };

  // Kiro markup is blanked with spaces, so positions in `text` are positions in `line`.
  const text = kiroText(line);
  const tk = tokenize(text);
  diagnostics.push(...tk.diagnostics);
  const ps = parse(tk.tokens, lexicon.robotNames, text);
  diagnostics.push(...ps.diagnostics);
  const ast = ps.ast;
  if (!ast || hasError(diagnostics)) return finish();

  const pattern = ast.pattern;
  const condition = ast.condition;
  let dims: Dimension[] = [];
  const perturbations: PerturbationCall[] = [];
  let triggerDur = 0;
  let disabledFeature = false;
  let stateBound: BoundClause<PredicateTemplate> | undefined;
  let stateTrigger: BoundClause<PerturbationTemplate> | undefined;
  let triggerTemplate: PerturbationTemplate | undefined;
  let dimsSources: (Span | undefined)[] = [];
  let dimsClause: Clause | undefined;

  if ((pattern === 'event' || pattern === 'unwanted') && condition) {
    const m = matchPerturbation(condition, lexicon);
    diagnostics.push(...m.diagnostics);
    if (m.bound) {
      const built = buildDimensions(m.bound, condition, true);
      diagnostics.push(...built.diagnostics);
      dims = built.dims;
      perturbations.push({ template: m.bound.template.phrase, params: built.params });
      triggerDur = triggerDuration(m.bound);
      triggerTemplate = m.bound.template;
      dimsSources = built.sources;
      dimsClause = condition;
    }
  } else if (pattern === 'state' && condition) {
    // A state is a predicate that must hold, or a perturbation applied for the whole episode.
    const s = matchState(condition, lexicon);
    diagnostics.push(...s.diagnostics);
    stateBound = s.predicate;
    if (s.perturbation) {
      const built = buildDimensions(s.perturbation, condition, true);
      diagnostics.push(...built.diagnostics);
      dims = built.dims;
      dimsSources = built.sources;
      perturbations.push({ template: s.perturbation.template.phrase, params: built.params });
      stateTrigger = s.perturbation;
    }
  } else if (pattern === 'optional' && condition) {
    // The feature clause must name a feature the Lexicon declares; it is enabled only when
    // listed in the options.
    const wanted = normaliseFeature(condition.text);
    const unknown = featureDiagnostic(condition, wanted, lexicon.features ?? []);
    if (unknown) diagnostics.push(unknown);
    const enabled = (options.enabledFeatures ?? []).some((f) => normaliseFeature(f) === wanted);
    disabledFeature = !enabled;
  }

  const resp = matchPredicate(ast.response, lexicon);
  diagnostics.push(...resp.diagnostics);
  if (stateBound && resp.wrapper?.kind === 'eventually') {
    // G(ψ → F φ) has no agreed meaning for a robot requirement; ask for `for` or nothing.
    const toks = ast.response.tokens;
    let w = toks.length - 1;
    while (w >= 0 && toks[w]!.text.toLowerCase() !== 'within') w--;
    const at = toks[Math.max(0, w)]!;
    diagnostics.push(makeDiagnostic(
      'PATTERN_MISMATCH',
      "A WHILE requirement is checked at every instant where its state holds, so its response takes 'for <duration>' or no time limit, not 'within'",
      { start: at.start, end: at.end, line: at.line, column: at.column },
    ));
  }

  if (pattern !== 'event' && pattern !== 'unwanted') {
    // Template dims: the response template's, then the state template's.
    for (const [b, clause] of [[resp.bound, ast.response], [stateBound, condition]] as const) {
      if (!b || !clause) continue;
      const built = buildDimensions(b, clause, false);
      diagnostics.push(...built.diagnostics);
      dims = dims.concat(built.dims);
      dimsSources = dimsSources.concat(built.sources);
    }
    dimsClause = ast.response;
  }
  diagnostics.push(...duplicateDimensions(dims, dimsSources, dimsClause));

  if (hasError(diagnostics) || !resp.bound) return finish();

  const wrapper: TemporalWrapper = resp.wrapper ?? { kind: 'always' };
  const episode = options.episodeSeconds ?? lexicon.episodeSeconds ?? DEFAULT_EPISODE_SECONDS;
  const timed = pattern === 'event' || pattern === 'unwanted';
  const onsetOf = (t: PerturbationTemplate | undefined): number =>
    t?.maxOnset !== undefined && Number.isFinite(t.maxOnset) && t.maxOnset > 0 ? t.maxOnset : 0;
  const onset = onsetOf(triggerTemplate ?? stateTrigger?.template);
  const horizon = horizonOf(timed, !!stateBound, wrapper, onset, triggerDur, episode);

  const spec: Parameters<typeof buildMonitor>[0] = {
    // A perturbation state is applied throughout, so its response is monitored as ubiquitous.
    pattern: stateTrigger ? 'ubiquitous' : pattern,
    predicate: resp.bound.template,
    slots: resp.bound.si,
    wrapper,
  };
  if (stateBound) spec.stateMargin = { predicate: stateBound.template, slots: stateBound.si };
  if (disabledFeature) spec.disabledFeature = true;
  if (onset > 0 && !stateBound) spec.onset = onset;

  const fin: FormulaInput = { timed, response: resp.bound, wrapper, onset };
  if (stateBound) fin.state = stateBound;
  if (stateTrigger && condition) fin.appliedState = condition.text;
  if (disabledFeature && condition) fin.disabledFeature = condition.text;

  return finish({
    id: ast.id ?? options.id ?? '',
    source: line,
    pattern,
    space: { dims },
    perturbations,
    horizon,
    formula: formulaOf(fin),
    monitor: buildMonitor(spec),
  });
}
