// Compiler: tokenizer -> parser -> matcher -> monitor builder -> CompiledRequirement.
// Pure: no clock, no randomness, no I/O.
import type { Clause } from './ast.js';
import { hasError, makeDiagnostic, sortDiagnostics, type Diagnostic } from './diagnostics.js';
import { extractCriteria, type RawCriterion } from './extract.js';
import { matchPerturbation, matchPredicate, type BoundClause } from './matcher.js';
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

/** The Dimension a slot was turned into, if any: same name, or `<template>.<slot>`. */
function dimensionOfSlot(dims: readonly Dimension[], slot: string): Dimension | undefined {
  return dims.find((d) => d.name === slot) ?? dims.find((d) => d.name.endsWith('.' + slot));
}

function perturbationCall(bound: BoundClause<PerturbationTemplate>): PerturbationCall {
  const dims = bound.dimensions ?? [];
  const params: Record<string, string | number> = {};
  for (const slot of Object.keys(bound.slots)) {
    const dim = dimensionOfSlot(dims, slot);
    if (dim) {
      params[slot] = dim.min < dim.max ? dim.name : dim.min;
      continue;
    }
    const direct = bound.si[slot];
    if (direct !== undefined) { params[slot] = direct; continue; }
    const lo = bound.si[`${slot}.min`];
    if (lo !== undefined && lo === bound.si[`${slot}.max`]) params[slot] = lo;
  }
  return { template: bound.template.phrase, params };
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
  let dimsSources: (Span | undefined)[] = [];
  let dimsClause: Clause | undefined;

  if ((pattern === 'event' || pattern === 'unwanted') && condition) {
    const m = matchPerturbation(condition, lexicon);
    diagnostics.push(...m.diagnostics);
    if (m.bound) {
      dims = m.bound.dimensions ?? [];
      perturbations.push(perturbationCall(m.bound));
      triggerDur = triggerDuration(m.bound);
      dimsSources = m.bound.dimensionSources ?? [];
      dimsClause = condition;
    }
  } else if (pattern === 'state' && condition) {
    const m = matchPredicate(condition, lexicon);
    diagnostics.push(...m.diagnostics);
    stateBound = m.bound;
  } else if (pattern === 'optional' && condition) {
    // The feature clause is a feature name; it is enabled only when listed in the options.
    const wanted = normaliseFeature(condition.text);
    const enabled = (options.enabledFeatures ?? []).some((f) => normaliseFeature(f) === wanted);
    disabledFeature = !enabled;
  }

  const resp = matchPredicate(ast.response, lexicon);
  diagnostics.push(...resp.diagnostics);

  if (pattern !== 'event' && pattern !== 'unwanted') {
    // Template dims: the response template's, then the state template's.
    if (resp.bound?.dimensions) {
      dims = dims.concat(resp.bound.dimensions);
      dimsSources = dimsSources.concat(resp.bound.dimensionSources ?? []);
    }
    if (stateBound?.dimensions) {
      const pad = dims.length - dimsSources.length;
      for (let k = 0; k < pad; k++) dimsSources.push(undefined);
      dims = dims.concat(stateBound.dimensions);
      dimsSources = dimsSources.concat(stateBound.dimensionSources ?? []);
    }
    dimsClause = ast.response;
  }
  diagnostics.push(...duplicateDimensions(dims, dimsSources, dimsClause));

  if (hasError(diagnostics) || !resp.bound) return finish();

  const wrapper: TemporalWrapper = resp.wrapper ?? { kind: 'always' };
  const episode = options.episodeSeconds ?? lexicon.episodeSeconds ?? DEFAULT_EPISODE_SECONDS;
  const horizon = (pattern === 'event' || pattern === 'unwanted') && wrapper.duration !== undefined
    ? wrapper.duration + triggerDur
    : episode;

  const spec: Parameters<typeof buildMonitor>[0] = {
    pattern,
    predicate: resp.bound.template,
    slots: resp.bound.si,
    wrapper,
  };
  if (stateBound) spec.stateMargin = { predicate: stateBound.template, slots: stateBound.si };
  if (disabledFeature) spec.disabledFeature = true;

  return finish({
    id: ast.id ?? options.id ?? '',
    source: line,
    pattern,
    space: { dims },
    perturbations,
    horizon,
    monitor: buildMonitor(spec),
  });
}
