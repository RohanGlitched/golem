// Regression test for defect 10: dims() received "any direction" as a raw string only.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Dimension, Lexicon, PerturbationTemplate } from '../types.js';
import { g1Lexicon, PUSH_PHRASE } from './g1Lexicon.js';

const LINE = 'WHEN the pelvis is pushed with up to 200 N for 0.2 s from behind at any point in its stride, THE golem SHALL stay upright';

describe('defect 10: the compiler builds dimensions from parsed ranges', () => {
  it('never calls dims() when the template declares slots', () => {
    let calls = 0;
    const t: PerturbationTemplate = {
      ...g1Lexicon().perturbations[0]!,
      dims: () => { calls++; return []; },
    };
    const r = compileRequirement(LINE, g1Lexicon({ perturbations: [t] }));
    expect(r.diagnostics).toEqual([]);
    expect(calls).toBe(0);
    expect(r.requirement!.space.dims[1]).toEqual({
      name: 'push.angle', kind: 'angle', min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4, severity: 'none', wrap: true,
    });
  });

  it('passes the parsed SI range of every slot to a legacy dims()', () => {
    let got: unknown;
    const t: PerturbationTemplate = {
      phrase: PUSH_PHRASE,
      dims: (_slots, ranges) => {
        got = ranges;
        const r = ranges!;
        const out: Dimension[] = [
          { name: 'push.force', kind: 'force', min: r['force']!.min, max: r['force']!.max, severity: 'up' },
          { name: 'push.angle', kind: 'angle', min: r['direction']!.min, max: r['direction']!.max, severity: 'none', wrap: true },
          { name: 'push.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
        ];
        return out;
      },
      apply: () => {},
    };
    const lex: Lexicon = g1Lexicon({ perturbations: [t] });
    const r = compileRequirement(LINE, lex);
    expect(r.diagnostics).toEqual([]);
    expect(got).toEqual({
      force: { kind: 'force', min: 0, max: 200, wrap: false },
      duration: { kind: 'duration', min: 0.2, max: 0.2, wrap: false },
      direction: { kind: 'angle', min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4, wrap: true },
      phase: { kind: 'phase', min: 0, max: 1, wrap: true },
    });
  });
});
