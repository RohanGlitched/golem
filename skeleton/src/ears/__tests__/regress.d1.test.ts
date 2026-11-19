// Regression test for defect 1: the push direction never reached the sim.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Lexicon } from '../types.js';
import { g1Lexicon, legacyLexicon, PUSH_PHRASE } from './g1Lexicon.js';

const ANY = 'R1. WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride, THE golem SHALL stay upright for 3 s';
const BEHIND_FIXED = 'WHEN the pelvis is pushed with 150 to 250 N for 200 ms from 90 deg at any point in its stride THE G1 SHALL stay upright for 3 s';

describe('defect 1: every slot reaches PerturbationCall.params', () => {
  it('passes the direction and phase dimension names for a searched push (declared slots)', () => {
    const r = compileRequirement(ANY, g1Lexicon());
    expect(r.diagnostics).toEqual([]);
    const q = r.requirement!;
    expect(q.space.dims).toEqual([
      { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' },
      { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
      { name: 'push.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
    ]);
    expect(q.perturbations).toEqual([{
      template: PUSH_PHRASE,
      params: { force: 'push.force', duration: 0.2, direction: 'push.angle', phase: 'push.phase' },
    }]);
  });

  it('passes a fixed direction as its SI angle', () => {
    const q = compileRequirement(BEHIND_FIXED, g1Lexicon()).requirement!;
    expect(q.perturbations[0]!.params).toEqual({
      force: 'push.force', duration: 0.2, direction: Math.PI / 2, phase: 'push.phase',
    });
    expect(q.space.dims[1]).toEqual({ name: 'push.angle', kind: 'angle', min: Math.PI / 2, max: Math.PI / 2, severity: 'none' });
  });

  it('ties a legacy dims() angle to the direction slot', () => {
    const r = compileRequirement(ANY, legacyLexicon());
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.perturbations[0]!.params).toEqual({
      force: 'push.force', duration: 0.2, direction: 'push.angle', phase: 'push.phase',
    });
  });

  it('rejects a searched slot that the lexicon gives no dimension', () => {
    const lex: Lexicon = g1Lexicon({
      perturbations: [{ phrase: PUSH_PHRASE, slots: { force: { dim: 'push.force', severity: 'up' } }, apply: () => {} }],
    });
    const r = compileRequirement(ANY, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => [d.kind, d.severity, ANY.slice(d.start, d.end), d.message])).toEqual([
      ['BAD_LEXICON', 'error', 'from any direction',
        `Slot {direction} of "${PUSH_PHRASE}" is searched over 'from any direction', but the Lexicon declares no dimension for it; add slots.direction to the template`],
      ['BAD_LEXICON', 'error', 'at any point in its stride',
        `Slot {phase} of "${PUSH_PHRASE}" is searched over 'at any point in its stride', but the Lexicon declares no dimension for it; add slots.phase to the template`],
    ]);
  });

  it('warns about a legacy searched dimension that no slot can take', () => {
    const lex: Lexicon = {
      robotNames: ['golem'],
      predicates: g1Lexicon().predicates,
      perturbations: [{
        phrase: 'the pelvis is pushed with {range:force}',
        dims: () => [
          { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' },
          { name: 'push.angle', kind: 'angle', min: 0, max: 1, severity: 'none' },
        ],
        apply: () => {},
      }],
    };
    const r = compileRequirement('WHEN the pelvis is pushed with up to 200 N THE golem SHALL stay upright', lex);
    expect(r.requirement!.perturbations[0]!.params).toEqual({ force: 'push.force' });
    expect(r.diagnostics.map((d) => [d.kind, d.severity, d.message])).toEqual([
      ['BAD_LEXICON', 'warning',
        `Dimension 'push.angle' of "the pelvis is pushed with {range:force}" is searched but tied to no slot, so the perturbation never receives it; declare slots on the template`],
    ]);
  });
});
