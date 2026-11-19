import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type {
  Dimension, Lexicon, PerturbationTemplate, PredicateTemplate, Quantity,
} from '../types.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 30: Compiled requirements carry the line's identity and ordered unique dimensions
// **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.7**

const NAMES = ['alpha', 'beta', 'gamma', 'delta'] as const;

type Slots = Record<string, Quantity | [Quantity, Quantity] | string>;

/** One Dimension per range slot, in slot (source) order, named `<prefix>.<slot>`. */
function rangeDims(prefix: string, slots: Slots): Dimension[] {
  const dims: Dimension[] = [];
  let i = 0;
  for (const [slot, v] of Object.entries(slots)) {
    if (!Array.isArray(v)) continue;
    dims.push({
      name: `${prefix}.${slot}`,
      kind: 'force',
      min: v[0].si,
      max: v[1].si,
      severity: i % 2 === 0 ? 'up' : 'down',
      ...(i % 2 === 1 ? { wrap: true } : {}),
    });
    i++;
  }
  return dims;
}

interface TemplateShape { name: string; ranges: number; duration: boolean }

const phraseOf = (t: TemplateShape): string =>
  `the ${t.name} is hit with ${Array.from({ length: t.ranges }, () => '{range:force}').join(' then ')}`
  + (t.duration ? ' for {duration}' : '');

const perturbationOf = (t: TemplateShape, dimsFn?: (s: Slots) => Dimension[]): PerturbationTemplate => ({
  phrase: phraseOf(t),
  dims: dimsFn ?? ((s) => rangeDims(t.name, s)),
  apply: () => {},
});

const stay: PredicateTemplate = {
  phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5,
};

const lexiconOf = (shapes: readonly TemplateShape[], extra: PerturbationTemplate[] = []): Lexicon => ({
  robotNames: ['robot'],
  predicates: [stay],
  perturbations: [...shapes.map((t) => perturbationOf(t)), ...extra],
  features: ['suction cup'],
});

const arbShapes: fc.Arbitrary<TemplateShape[]> = fc
  .tuple(
    fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }),
    fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }),
    fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
  )
  .chain(([a, b, c, d, e, f, g, h]) => fc.integer({ min: 1, max: 4 }).map((n) => {
    const r = [a, b, c, d];
    const du = [e, f, g, h];
    return NAMES.slice(0, n).map((name, i) => ({ name, ranges: r[i]!, duration: du[i]! }));
  }));

interface RangeText { text: string; min: number; max: number }

const arbRange: fc.Arbitrary<RangeText> = fc.oneof(
  fc.integer({ min: 1, max: 500 }).map((x) => ({ text: `up to ${x} N`, min: 0, max: x })),
  fc.tuple(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 100 }))
    .map(([a, d]) => ({ text: `${a} to ${a + d} N`, min: a, max: a + d })),
  fc.integer({ min: 1, max: 500 }).map((x) => ({ text: `${x} N`, min: x, max: x })),
);

const arbDuration = fc.integer({ min: 1, max: 9 }).map((x) => ({ text: `0.${x} s`, si: x / 10 }));

const arbIdPrefix: fc.Arbitrary<{ prefix: string; id: string }> = fc.oneof(
  fc.constant({ prefix: '', id: '' }),
  fc.integer({ min: 1, max: 99 }).map((n) => ({ prefix: `R${n}. `, id: `R${n}` })),
  fc.tuple(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }))
    .map(([n, m]) => ({ prefix: `${n}.${m} `, id: `${n}.${m}` })),
);

interface Case {
  shapes: TemplateShape[];
  pick: number;
  ranges: RangeText[];
  duration: { text: string; si: number };
  withId: { prefix: string; id: string };
  optionId: string | undefined;
  unwanted: boolean;
}

const arbCase: fc.Arbitrary<Case> = arbShapes.chain((shapes) =>
  fc.record({
    shapes: fc.constant(shapes),
    pick: fc.integer({ min: 0, max: shapes.length - 1 }),
    ranges: fc.array(arbRange, { minLength: 3, maxLength: 3 }),
    duration: arbDuration,
    withId: arbIdPrefix,
    optionId: fc.option(fc.constantFrom('9.9', 'Z1'), { nil: undefined }),
    unwanted: fc.boolean(),
  }));

const triggerOf = (c: Case): string => {
  const t = c.shapes[c.pick]!;
  return `the ${t.name} is hit with ${c.ranges.slice(0, t.ranges).map((r) => r.text).join(' then ')}`
    + (t.duration ? ` for ${c.duration.text}` : '');
};

describe('compileRequirement identity and dimensions (Property 30)', () => {
  it('carries id, source, pattern, ordered unique dims and one perturbation per trigger', () => {
    fc.assert(
      fc.property(arbCase, ({ shapes, pick, ranges, duration, withId, optionId, unwanted }) => {
        const c = { shapes, pick, ranges, duration, withId, optionId, unwanted };
        const lex = lexiconOf(shapes);
        const t = shapes[pick]!;
        const trigger = triggerOf(c);
        const line = unwanted
          ? `${withId.prefix}IF ${trigger} THEN THE robot SHALL stay upright`
          : `${withId.prefix}WHEN ${trigger} THE robot SHALL stay upright`;
        const r = compileRequirement(line, lex, optionId === undefined ? {} : { id: optionId });
        expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        const req = r.requirement!;
        expect(req).toBeDefined();

        expect(req.source).toBe(line);
        expect(req.pattern).toBe(unwanted ? 'unwanted' : 'event');
        expect(req.id).toBe(withId.prefix !== '' ? withId.id : (optionId ?? ''));

        const used = ranges.slice(0, t.ranges);
        const names = req.space.dims.map((d) => d.name);
        expect(names).toEqual(used.map((_, i) => `${t.name}.${i === 0 ? 'force' : `force${i + 1}`}`));
        expect(new Set(names).size).toBe(names.length);
        req.space.dims.forEach((d, i) => {
          expect(d.min).toBe(used[i]!.min);
          expect(d.max).toBe(used[i]!.max);
          expect(d.severity).toBe(i % 2 === 0 ? 'up' : 'down');
          expect(d.wrap === true).toBe(i % 2 === 1);
        });

        expect(req.perturbations).toHaveLength(1);
        const call = req.perturbations[0]!;
        expect(call.template).toBe(phraseOf(t));
        const expected: Record<string, string | number> = {};
        used.forEach((rg, i) => {
          expected[i === 0 ? 'force' : `force${i + 1}`] = rg.min < rg.max ? names[i]! : rg.min;
        });
        if (t.duration) expected['duration'] = duration.si;
        expect(call.params).toEqual(expected);
      }),
      propConfig,
    );
  });

  it('keeps source and id for ubiquitous, state and optional lines and gives them no dims', () => {
    const arbPattern = fc.constantFrom(
      ['THE robot SHALL stay upright', 'ubiquitous'],
      ['WHILE stay upright THE robot SHALL stay upright', 'state'],
      ['WHERE suction cup THE robot SHALL stay upright', 'optional'],
    );
    fc.assert(
      fc.property(arbPattern, arbIdPrefix, fc.option(fc.constantFrom('9.9', 'Z1'), { nil: undefined }),
        ([body, pattern], withId, optionId) => {
          const line = withId.prefix + body;
          const r = compileRequirement(line, lexiconOf([{ name: 'alpha', ranges: 1, duration: false }]),
            optionId === undefined ? {} : { id: optionId });
          expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
          const req = r.requirement!;
          expect(req.source).toBe(line);
          expect(req.pattern).toBe(pattern);
          expect(req.id).toBe(withId.prefix !== '' ? withId.id : (optionId ?? ''));
          expect(req.space.dims).toEqual([]);
          expect(req.perturbations).toEqual([]);
        }),
      propConfig,
    );
  });

  it('emits an error and returns no requirement when two dimensions share a name', () => {
    const shape: TemplateShape = { name: 'omega', ranges: 2, duration: false };
    const dupTemplate = perturbationOf(shape, (s) => rangeDims('same', s).map((d) => ({ ...d, name: 'same.x' })));
    fc.assert(
      fc.property(arbRange, arbRange, arbIdPrefix, (a, b, withId) => {
        const lex: Lexicon = { robotNames: ['robot'], predicates: [stay], perturbations: [dupTemplate] };
        const line = `${withId.prefix}WHEN the omega is hit with ${a.text} then ${b.text} THE robot SHALL stay upright`;
        const r = compileRequirement(line, lex);
        expect(r.requirement).toBeUndefined();
        const errs = r.diagnostics.filter((d) => d.severity === 'error');
        expect(errs.length).toBeGreaterThanOrEqual(1);
        expect(errs.some((d) => d.message.includes('same.x'))).toBe(true);
      }),
      propConfig,
    );
  });

  // Requirement 12.7: the duplicate is reported at the start of the second occurrence.
  it('places the duplicate-dimension error at the second occurrence', () => {
    const shape: TemplateShape = { name: 'omega', ranges: 2, duration: false };
    const dupTemplate = perturbationOf(shape, (s) => rangeDims('same', s).map((d) => ({ ...d, name: 'same.x' })));
    const lex: Lexicon = { robotNames: ['robot'], predicates: [stay], perturbations: [dupTemplate] };
    const line = 'WHEN the omega is hit with up to 5 N then up to 7 N THE robot SHALL stay upright';
    const err = compileRequirement(line, lex).diagnostics.find((d) => d.severity === 'error')!;
    expect(line.indexOf('up to 7 N')).toBe(42);
    expect(err.start).toBe(42);
  });
});
