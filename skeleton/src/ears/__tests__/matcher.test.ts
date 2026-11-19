import { describe, expect, it } from 'vitest';
import type { Clause } from '../ast.js';
import { compileTemplate, compiledTemplates, matchPerturbation, matchPredicate } from '../matcher.js';
import { tokenize } from '../tokenizer.js';
import type { Lexicon, PerturbationTemplate, PredicateTemplate } from '../types.js';

/** Builds a clause from text. Prefixed with a word so a leading number is not read as an ID. */
function clauseOf(text: string): Clause {
  const tokens = tokenize('x ' + text).tokens.slice(1);
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return { text, tokens, span: { start: first.start, end: last.end, line: first.line, column: first.column } };
}

const pred = (phrase: string): PredicateTemplate => ({
  phrase, signals: ['s'], unit: 'm', margin: () => 1,
});
const pert = (phrase: string, dims: PerturbationTemplate['dims'] = () => []): PerturbationTemplate => ({
  phrase, dims, apply: () => {},
});
const lex = (predicates: PredicateTemplate[], perturbations: PerturbationTemplate[]): Lexicon => ({
  robotNames: ['robot'], predicates, perturbations,
});

describe('compileTemplate', () => {
  it('lower-cases literals and names slots by kind, numbering repeats', () => {
    const t = compileTemplate('Keep {length} and {length} {range:force} {direction}', 3);
    expect(t.index).toBe(3);
    expect(t.pattern).toEqual([
      'keep',
      { slot: 'length', name: 'length' },
      'and',
      { slot: 'length', name: 'length2' },
      { slot: 'range', name: 'force', rangeKind: 'force' },
      { slot: 'direction', name: 'direction' },
    ]);
  });

  it('rejects an unknown slot', () => {
    expect(() => compileTemplate('keep {lenght}', 0)).toThrow(/Unknown slot/);
  });

  it('caches per Lexicon object', () => {
    const l = lex([pred('stay upright')], []);
    expect(compiledTemplates(l)).toBe(compiledTemplates(l));
  });
});

describe('matchPredicate', () => {
  const l = lex([pred('stay upright'), pred('keep its pelvis above {length}')], []);

  it('binds a slot to the SI value and ignores literal case', () => {
    const r = matchPredicate(clauseOf('KEEP its Pelvis above 50 cm'), l);
    expect(r.diagnostics).toEqual([]);
    expect(r.bound?.template.phrase).toBe('keep its pelvis above {length}');
    expect(r.bound?.si.length).toBeCloseTo(0.5, 12);
    expect(r.wrapper).toBeUndefined();
  });

  it('strips a trailing `for <duration>` into an always wrapper', () => {
    const r = matchPredicate(clauseOf('stay upright for 3 s'), l);
    expect(r.diagnostics).toEqual([]);
    expect(r.wrapper).toEqual({ kind: 'always', duration: 3 });
  });

  it('strips a trailing `within <duration>` into an eventually wrapper', () => {
    const r = matchPredicate(clauseOf('stay upright within 600 ms'), l);
    expect(r.wrapper?.kind).toBe('eventually');
    expect(r.wrapper?.duration).toBeCloseTo(0.6, 12);
  });

  it('keeps a wrapper that belongs to the template phrase', () => {
    const c = lex([pred('drop every candy within {duration}')], []);
    const r = matchPredicate(clauseOf('drop every candy within 6 s'), c);
    expect(r.diagnostics).toEqual([]);
    expect(r.bound?.si.duration).toBe(6);
    expect(r.wrapper).toEqual({ kind: 'eventually', duration: 6 });
  });

  it('suggests the closest phrase for a misspelt word', () => {
    const r = matchPredicate(clauseOf('stay upryght'), l);
    expect(r.bound).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('UNKNOWN_PHRASE');
    expect(d.suggestion).toBe('stay upright');
    expect(d.column).toBe(clauseOf('stay upryght').tokens[1]!.column);
  });

  it('does not match a missing word, an extra word or a different order', () => {
    for (const text of ['stay', 'stay upright now', 'upright stay']) {
      const r = matchPredicate(clauseOf(text), l);
      expect(r.bound, text).toBeUndefined();
      expect(r.diagnostics[0]!.kind).toBe('UNKNOWN_PHRASE');
    }
  });

  it('omits the suggestion and says so when no phrase is close', () => {
    const r = matchPredicate(clauseOf('dance wildly tonight now'), l);
    const d = r.diagnostics[0]!;
    expect(d.suggestion).toBeUndefined();
    expect(d.message).toContain('No close phrase exists');
  });

  it('names both kinds on a kind mismatch and binds nothing', () => {
    const r = matchPredicate(clauseOf('keep its pelvis above 3 s'), l);
    expect(r.bound).toBeUndefined();
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('UNKNOWN_PHRASE');
    expect(d.message).toContain('length');
    expect(d.message).toContain('duration');
  });

  it('reports a missing unit', () => {
    const r = matchPredicate(clauseOf('keep its pelvis above 3'), l);
    expect(r.diagnostics[0]!.kind).toBe('MISSING_UNIT');
  });

  it('lists every phrase of an ambiguous pair in Lexicon order and binds nothing', () => {
    const a = lex([pred('stay upright'), pred('Stay Upright')], []);
    const r = matchPredicate(clauseOf('stay upright'), a);
    expect(r.bound).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const m = r.diagnostics[0]!.message;
    expect(m.indexOf('"stay upright"')).toBeGreaterThanOrEqual(0);
    expect(m.indexOf('"stay upright"')).toBeLessThan(m.indexOf('"Stay Upright"'));
  });

  it('says the Lexicon has no predicate template when the class is empty', () => {
    const r = matchPredicate(clauseOf('stay upright'), lex([], [pert('x')]));
    expect(r.bound).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.message).toContain('no predicate template');
    expect(r.diagnostics[0]!.suggestion).toBeUndefined();
  });
});

describe('matchPerturbation', () => {
  const push = pert(
    'the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}',
    (slots) => {
      const f = slots.force as [{ si: number }, { si: number }];
      return [{ name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' }];
    },
  );
  const slope = pert('walking on a slope of {range:angle}');
  const l = lex([], [push, slope]);

  it('binds a range, a fixed duration, a direction and a phase, and passes the range to dims', () => {
    const r = matchPerturbation(
      clauseOf('the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride'),
      l,
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.bound?.si['force.min']).toBe(0);
    expect(r.bound?.si['force.max']).toBe(200);
    expect(r.bound?.si.duration).toBeCloseTo(0.2, 12);
    expect(r.bound?.slots.direction).toBe('any direction');
    expect(r.bound?.slots.phase).toBe('any point in its stride');
    expect(r.bound?.ranges.direction!.wrap).toBe(true);
    expect(r.bound?.dimensions).toEqual([
      { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' },
    ]);
  });

  it('accepts `from behind` and a `<q> to <q>` range', () => {
    const r = matchPerturbation(
      clauseOf('the pelvis is pushed with 150 to 250 N for 0.2 s from behind at any point in its stride'),
      l,
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.bound?.si['force.min']).toBe(150);
    expect(r.bound?.slots.direction).toBe('behind');
  });

  it('names both kinds when a range has the wrong kind', () => {
    const r = matchPerturbation(clauseOf('walking on a slope of up to 5 N'), l);
    expect(r.bound).toBeUndefined();
    const d = r.diagnostics[0]!;
    expect(d.message).toContain('angle');
    expect(d.message).toContain('force');
  });

  it('reports a second range bound to the same slot as BAD_RANGE at the second range', () => {
    const c = clauseOf('walking on a slope of up to 5 deg up to 9 deg');
    const r = matchPerturbation(c, l);
    expect(r.bound).toBeUndefined();
    expect(r.diagnostics[0]!.kind).toBe('BAD_RANGE');
    expect(r.diagnostics[0]!.start).toBe(c.tokens[9]!.start);
  });

  it('reports an empty perturbation class', () => {
    const r = matchPerturbation(clauseOf('anything'), lex([pred('x')], []));
    expect(r.diagnostics[0]!.message).toContain('no perturbation template');
  });

  it('gives the closest perturbation phrase for a typo', () => {
    const r = matchPerturbation(clauseOf('walking on a slop of up to 5 deg'), l);
    expect(r.diagnostics[0]!.suggestion).toBe('walking on a slope of {range:angle}');
  });
});
