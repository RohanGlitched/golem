// Regression test for defect 13: robot names of more than one word were rejected.
import { describe, expect, it } from 'vitest';
import { stripOffsets } from '../ast.js';
import { compileRequirement } from '../compile.js';
import { format } from '../format.js';
import { parse } from '../parser.js';
import { tokenize } from '../tokenizer.js';
import type { Lexicon } from '../types.js';

const lex: Lexicon = {
  robotNames: ['golem', 'Unitree G1'],
  perturbations: [{ phrase: 'the pelvis is pushed with {force}', dims: () => [], apply: () => {} }],
  predicates: [{ phrase: 'stay upright', signals: ['z'], unit: 'm', margin: (s) => s['z']! - 0.5 }],
};

describe('defect 13: multi-word robot names', () => {
  it('compiles THE Unitree G1 SHALL', () => {
    const r = compileRequirement('THE Unitree G1 SHALL stay upright', lex);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.pattern).toBe('ubiquitous');
  });

  it('stores the name joined by one space with a span over both words', () => {
    const line = 'WHEN the pelvis is pushed with 5 N, THE unitree   g1 SHALL stay upright';
    const { ast, diagnostics } = parse(tokenize(line).tokens, lex.robotNames, line);
    expect(diagnostics).toEqual([]);
    const start = line.indexOf('unitree');
    expect(ast!.robot).toEqual({ name: 'unitree g1', span: { start, end: line.indexOf('SHALL') - 1, line: 1, column: start + 1 } });
    const again = format(ast!);
    expect(again).toBe('WHEN THE pelvis is pushed with 5 N, THE unitree g1 SHALL stay upright');
    const re = parse(tokenize(again).tokens, lex.robotNames, again);
    expect(stripOffsets(re.ast!)).toEqual(stripOffsets(ast!));
  });

  it('reports an unknown multi-word name at the whole name', () => {
    const line = 'THE Unitree H1 SHALL stay upright';
    const r = compileRequirement(line, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics).toEqual([{
      kind: 'UNKNOWN_ROBOT', severity: 'error',
      message: "Unknown robot 'Unitree H1'; allowed names: golem, Unitree G1",
      line: 1, column: 5, start: 4, end: 14, suggestion: 'golem, Unitree G1',
    }]);
  });
});
