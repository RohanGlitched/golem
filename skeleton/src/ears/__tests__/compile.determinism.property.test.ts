import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import type { CompileOptions, Lexicon, Trace } from '../types.js';
import { arbLexicon, arbMutation, arbValidLine } from './generators.js';
import { arbTrace } from './generators.trace.js';
import { deepFreeze, propConfig } from './support.js';

/** Stable text of a value that may hold functions (Lexicon members): functions by source text. */
const snap = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'function' ? `fn:${(x as () => unknown).toString()}` : x));

interface Case { lexicon: Lexicon; line: string; options: CompileOptions; trace: Trace }

const arbOptions = (feature: string | undefined): fc.Arbitrary<CompileOptions> =>
  fc
    .tuple(
      fc.option(fc.constantFrom('R1', '7.2', 'X'), { nil: undefined }),
      fc.option(fc.integer({ min: 1, max: 40 }).map((k) => k / 4), { nil: undefined }),
      fc.boolean(),
    )
    .map(([id, episodeSeconds, enable]) => {
      const o: CompileOptions = {};
      if (id !== undefined) o.id = id;
      if (episodeSeconds !== undefined) o.episodeSeconds = episodeSeconds;
      if (enable && feature !== undefined) o.enabledFeatures = [feature];
      return o;
    });

/** Valid lines and mutated lines (so error paths are covered) over a random Lexicon. */
const arbCase: fc.Arbitrary<Case> = arbLexicon.chain((lexicon) => {
  const signals = [...new Set(lexicon.predicates.flatMap((p) => p.signals))];
  return arbValidLine(lexicon).chain((gen) =>
    fc
      .tuple(
        fc.oneof(fc.constant(gen.text), arbMutation(gen.text).map((m) => m.text)),
        arbOptions(gen.pattern === 'optional' ? gen.condition?.text : undefined),
        arbTrace({ signals, maxSamples: 120 }),
      )
      .map(([line, options, trace]) => ({ lexicon, line, options, trace })),
  );
});

type R = { robustness: number; worstAt: number; unit: string };
const same = (a: R, b: R): boolean =>
  Object.is(a.robustness, b.robustness) && Object.is(a.worstAt, b.worstAt) && a.unit === b.unit;

describe('Feature: golem-ears, Property 29: Compiling is deterministic and does not mutate its inputs', () => {
  it('compiling twice gives deeply equal diagnostics and requirement fields and bit-identical monitor results', () => {
    // **Validates: Requirements 1.11, 3.16, 8.13, 12.11, 12.13, 13.7**
    let compiled = 0;
    fc.assert(
      fc.property(arbCase, ({ lexicon, line, options, trace }) => {
        const a = compileRequirement(line, lexicon, options);
        const b = compileRequirement(line, lexicon, options);
        expect(b.diagnostics).toEqual(a.diagnostics);
        expect(b.requirement === undefined).toBe(a.requirement === undefined);
        const x = a.requirement;
        const y = b.requirement;
        if (!x || !y) return;
        compiled++;
        expect(y.id).toBe(x.id);
        expect(y.source).toBe(x.source);
        expect(y.pattern).toBe(x.pattern);
        expect(y.space).toEqual(x.space);
        expect(y.perturbations).toEqual(x.perturbations);
        expect(Object.is(y.horizon, x.horizon)).toBe(true);
        expect(y.formula).toBe(x.formula);
        const r1 = x.monitor(trace);
        expect(same(r1, y.monitor(trace))).toBe(true);
        expect(same(r1, x.monitor(trace))).toBe(true);
      }),
      propConfig,
    );
    expect(compiled).toBeGreaterThan(0);
  });

  it('compiles against a deep-frozen Lexicon and options without throwing or changing them', () => {
    // **Validates: Requirements 1.11, 3.16, 8.13, 12.11, 12.13, 13.7**
    fc.assert(
      fc.property(arbCase, ({ lexicon, line, options, trace }) => {
        const plain = compileRequirement(line, lexicon, options);
        const lexBefore = snap(lexicon);
        const optBefore = snap(options);
        const members = lexicon.predicates.map((p) => p.margin);
        deepFreeze(lexicon);
        deepFreeze(options);
        const frozen = compileRequirement(line, lexicon, options);
        expect(frozen.diagnostics).toEqual(plain.diagnostics);
        expect(frozen.requirement === undefined).toBe(plain.requirement === undefined);
        if (frozen.requirement && plain.requirement) {
          expect(frozen.requirement.space).toEqual(plain.requirement.space);
          expect(frozen.requirement.perturbations).toEqual(plain.requirement.perturbations);
          expect(same(frozen.requirement.monitor(trace), plain.requirement.monitor(trace))).toBe(true);
        }
        expect(snap(lexicon)).toBe(lexBefore);
        expect(snap(options)).toBe(optBefore);
        expect(lexicon.predicates.map((p) => p.margin)).toEqual(members);
      }),
      propConfig,
    );
  });

  it('tokenizing, parsing and formatting the same input twice give equal results', () => {
    // **Validates: Requirements 1.11, 3.16, 8.13**
    fc.assert(
      fc.property(arbCase, ({ lexicon, line }) => {
        const t1 = tokenize(line);
        const t2 = tokenize(line);
        expect(t2).toEqual(t1);
        const p1 = parse(t1.tokens, lexicon.robotNames, line);
        const p2 = parse(t1.tokens, lexicon.robotNames, line);
        expect(p2).toEqual(p1);
        if (p1.ast) expect(format(p1.ast)).toBe(format(p2.ast!));
      }),
      propConfig,
    );
  });
});
