// Hidden slots: a template declares a Dimension that no slot of its phrase carries (a hand's entry
// time, where each candy lands). The compiler adds it and passes it to apply under the slot name.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import { lintLexicon } from '../lint.js';
import type { HiddenRange, Lexicon, PerturbationTemplate, SlotDimension } from '../types.js';
import { upright } from './g1Lexicon.js';

const PHRASE = 'a hand reaches in from {direction} at {range:speed}';
const LINE = 'WHEN a hand reaches in from any direction at up to 1.5 m/s THE robot SHALL stay upright';

const hand = (hidden: Record<string, SlotDimension> = {}): PerturbationTemplate => ({
  phrase: PHRASE,
  slots: {
    direction: { dim: 'hand.angle', severity: 'none' },
    speed: { dim: 'hand.speed', severity: 'up' },
    ...hidden,
  },
  apply: () => {},
});
const lex = (t: PerturbationTemplate): Lexicon => ({ robotNames: ['robot'], predicates: [upright], perturbations: [t] });
const entry: SlotDimension = { dim: 'hand.entry', severity: 'none', range: { kind: 'duration', min: 0, max: 3 } };

describe('hidden slots', () => {
  it('adds the Dimension with the declared range and passes its name under the slot name', () => {
    const r = compileRequirement(LINE, lex(hand({ entry })));
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.space.dims).toEqual([
      { name: 'hand.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
      { name: 'hand.speed', kind: 'speed', min: 0, max: 1.5, severity: 'up' },
      { name: 'hand.entry', kind: 'duration', min: 0, max: 3, severity: 'none' },
    ]);
    expect(r.requirement!.perturbations[0]!.params).toEqual({ direction: 'hand.angle', speed: 'hand.speed', entry: 'hand.entry' });
  });

  it('passes a fixed hidden range as its SI value and keeps its wrap flag', () => {
    const fixed: SlotDimension = { dim: 'hand.height', severity: 'none', range: { kind: 'length', min: 0.15, max: 0.15 } };
    const wrapped: SlotDimension = { dim: 'hand.roll', severity: 'none', range: { kind: 'angle', min: 0, max: 6, wrap: true } };
    const q = compileRequirement(LINE, lex(hand({ height: fixed, roll: wrapped }))).requirement!;
    expect(q.perturbations[0]!.params).toMatchObject({ height: 0.15, roll: 'hand.roll' });
    expect(q.space.dims.find((d) => d.name === 'hand.roll')).toMatchObject({ wrap: true });
    expect(q.space.dims.find((d) => d.name === 'hand.height')).toMatchObject({ min: 0.15, max: 0.15 });
  });

  it('uses the range written in the line for a slot that the phrase does contain', () => {
    const r = compileRequirement(LINE, lex(hand({
      speed: { dim: 'hand.speed', severity: 'up', range: { kind: 'speed', min: 0, max: 9 } },
    })));
    expect(r.requirement!.space.dims.find((d) => d.name === 'hand.speed')).toMatchObject({ max: 1.5 });
  });

  it('adds hidden dimensions to a template whose phrase has no slot at all', () => {
    const t: PerturbationTemplate = {
      phrase: 'candies land anywhere on the tray',
      slots: { 'candy.0.x': { dim: 'candy.0.x', severity: 'none', range: { kind: 'length', min: 0.35, max: 0.39 } } },
      apply: () => {},
    };
    const r = compileRequirement('WHEN candies land anywhere on the tray THE robot SHALL stay upright', lex(t));
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.perturbations[0]!.params).toEqual({ 'candy.0.x': 'candy.0.x' });
  });

  it('reports a hidden dimension that repeats another dimension name', () => {
    const dup: SlotDimension = { dim: 'hand.speed', severity: 'none', range: { kind: 'speed', min: 0, max: 1 } };
    const r = compileRequirement(LINE, lex(hand({ other: dup })));
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => d.kind)).toEqual(['BAD_RANGE']);
  });

  it('lints a hidden slot clean, a bad range as an error and a range on a phrase slot as a warning', () => {
    expect(lintLexicon(lex(hand({ entry })))).toEqual([]);
    const bad: SlotDimension = { dim: 'x', severity: 'none', range: { kind: 'length', min: 2, max: 1 } };
    expect(lintLexicon(lex(hand({ bad }))).map((f) => [f.severity, f.code])).toEqual([['error', 'UNKNOWN_SLOT']]);
    const onSlot = hand({ speed: { dim: 'hand.speed', severity: 'up', range: { kind: 'speed', min: 0, max: 1 } } });
    expect(lintLexicon(lex(onSlot)).map((f) => [f.severity, f.code])).toEqual([['warning', 'SLOT_IGNORED']]);
  });

  it('property: every searched dimension of the compiled space appears in the params, and every param is a dimension or a number', () => {
    const kinds = ['length', 'duration', 'mass', 'force'] as const;
    const hiddenRange = fc.record({
      kind: fc.constantFrom(...kinds),
      min: fc.double({ min: 0, max: 10, noNaN: true }),
      span: fc.oneof(fc.constant(0), fc.double({ min: 1e-6, max: 10, noNaN: true })),
    }).map((r): HiddenRange => ({ kind: r.kind, min: r.min, max: r.min + r.span }));
    fc.assert(fc.property(fc.array(hiddenRange, { maxLength: 8 }), (ranges) => {
      const hidden: Record<string, SlotDimension> = {};
      ranges.forEach((range, i) => { hidden[`h${i}`] = { dim: `hidden.${i}`, severity: 'none', range }; });
      const r = compileRequirement(LINE, lex(hand(hidden)));
      expect(r.diagnostics).toEqual([]);
      const q = r.requirement!;
      const params = Object.values(q.perturbations[0]!.params);
      for (const d of q.space.dims) {
        if (d.min < d.max) expect(params).toContain(d.name);
      }
      ranges.forEach((range, i) => {
        const p = q.perturbations[0]!.params[`h${i}`];
        expect(p).toBe(range.min < range.max ? `hidden.${i}` : range.min);
      });
    }), { numRuns: 100 });
  });
});
