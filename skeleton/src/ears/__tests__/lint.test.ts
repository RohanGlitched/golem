// Improvement 5 of golem-ears-hardening: the lexicon linter.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lintLexicon, type LintFinding } from '../lint.js';
import type { Lexicon, PredicateTemplate } from '../types.js';
import { arbLexicon } from './generators.js';
import { g1Lexicon, legacyLexicon, PUSH_PHRASE, push, upright } from './g1Lexicon.js';
import { propConfig } from './support.js';

const codes = (f: LintFinding[]) => f.map((x) => [x.severity, x.code, x.template ?? '']);
const pred = (over: Partial<PredicateTemplate>): PredicateTemplate => ({
  phrase: 'keep its pelvis above {length}', signals: ['z'], unit: 'm', margin: (s, k) => s['z']! - k['length']!, ...over,
});
const lexWith = (over: Partial<Lexicon>): Lexicon => ({ robotNames: ['golem'], perturbations: [], predicates: [], ...over });

describe('lintLexicon', () => {
  it('finds nothing in the realistic G1 lexicon', () => {
    expect(lintLexicon(g1Lexicon({ features: ['the payload kit is fitted'] }))).toEqual([]);
  });

  it('flags the deprecated dims()', () => {
    expect(codes(lintLexicon(legacyLexicon()))).toEqual([['warning', 'DEPRECATED_DIMS', PUSH_PHRASE]]);
  });

  it('flags robot names and features that cannot work', () => {
    const f = lintLexicon(lexWith({ robotNames: ['golem', 'Golem', 'the robot', 'G-1!'], features: ['kit', ' kit ', ''] }));
    expect(codes(f)).toEqual([
      ['warning', 'ROBOT_NAMES', ''], ['error', 'ROBOT_NAMES', ''], ['error', 'ROBOT_NAMES', ''],
      ['warning', 'FEATURES', ''], ['error', 'FEATURES', ''],
    ]);
    expect(codes(lintLexicon(lexWith({ robotNames: [] })))).toEqual([['error', 'ROBOT_NAMES', '']]);
  });

  it('flags slot declarations that lose or duplicate a dimension', () => {
    const f = lintLexicon(lexWith({
      perturbations: [{
        phrase: PUSH_PHRASE,
        slots: { force: { dim: 'push.x', severity: 'up' }, phase: { dim: 'push.x', severity: 'none' }, angle: { dim: 'push.a', severity: 'none' } },
        maxOnset: -1,
        apply: () => {},
      }],
    }));
    expect(codes(f)).toEqual([
      ['error', 'UNKNOWN_SLOT', PUSH_PHRASE],
      ['error', 'UNDECLARED_SLOT', PUSH_PHRASE],
      ['error', 'DUPLICATE_DIMENSION', PUSH_PHRASE],
      ['error', 'BAD_ONSET', PUSH_PHRASE],
    ]);
    expect(f[1]!.message).toBe("Slot 'direction' can hold a searched range but slots.direction is not declared, so a line that gives a range there does not compile");
  });

  it('flags a malformed phrase without throwing', () => {
    const f = lintLexicon(lexWith({ predicates: [pred({ phrase: 'keep {height} up' })] }));
    expect(codes(f)).toEqual([['error', 'MALFORMED_PHRASE', 'keep {height} up']]);
  });

  it('flags ambiguous templates and a template that cannot match its own sample', () => {
    const f = lintLexicon(g1Lexicon({
      perturbations: [push, { ...push }, { phrase: 'pushed toward {direction}', slots: { direction: { dim: 'd', severity: 'none' } }, apply: () => {} }],
    }));
    expect(codes(f)).toEqual([
      ['error', 'AMBIGUOUS_TEMPLATES', PUSH_PHRASE],
      ['error', 'UNMATCHABLE', 'pushed toward {direction}'],
    ]);
  });

  it('evaluates margins on sampled signals', () => {
    const f = lintLexicon(lexWith({
      predicates: [
        pred({ phrase: 'reads a hidden signal', margin: (s) => s['z']! - s['hidden']! }),
        pred({ phrase: 'throws', margin: () => { throw new Error('boom'); } }),
        pred({ phrase: 'ignores {length}', margin: (s) => s['z']! }),
        pred({ phrase: 'tilts below {angle}', unit: 'deg', margin: (s, k) => k['angle']! - s['z']! }),
        pred({ phrase: 'divides', margin: (s) => 1 / s['z']! }),
        pred({ phrase: 'has no signals', signals: [], unit: 'furlongs', margin: () => 1 }),
      ],
    }));
    expect(codes(f)).toEqual([
      ['error', 'UNLISTED_SIGNAL', 'reads a hidden signal'],
      ['warning', 'MARGIN_NOT_FINITE', 'reads a hidden signal'],
      ['error', 'MARGIN_THROWS', 'throws'],
      ['warning', 'SLOT_IGNORED', 'ignores {length}'],
      ['warning', 'UNIT_MISMATCH', 'tilts below {angle}'],
      ['warning', 'MARGIN_NOT_FINITE', 'divides'],
      ['warning', 'NO_SIGNALS', 'has no signals'],
      ['warning', 'UNKNOWN_UNIT', 'has no signals'],
    ]);
    expect(f.find((x) => x.code === 'UNIT_MISMATCH')!.message)
      .toBe("margin moves 1:1 with slot 'angle' (a angle, SI unit rad), but unit is 'deg'");
  });

  it('uses the samples it is given', () => {
    const f = lintLexicon(lexWith({ predicates: [upright] }), { samples: [{ pelvis_z: NaN, tilt_deg: 0 }] });
    expect(codes(f)).toEqual([['warning', 'MARGIN_NOT_FINITE', 'stay upright']]);
  });

  it('never throws and finds no error in a generated lexicon', () => {
    fc.assert(fc.property(arbLexicon, (lex) => {
      const f = lintLexicon(lex);
      expect(f.filter((x) => x.severity === 'error')).toEqual([]);
    }), propConfig);
  });
});
