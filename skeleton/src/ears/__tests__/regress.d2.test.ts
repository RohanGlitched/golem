// Regression test for defect 2: Kiro's trailing periods and inline markdown were rejected.
import { describe, expect, it } from 'vitest';
import { compileRequirement, compileRequirementsFile } from '../compile.js';
import { extractCriteria } from '../extract.js';
import * as tokenizer from '../tokenizer.js';
import type { Lexicon } from '../types.js';

const lex: Lexicon = {
  robotNames: ['golem'],
  perturbations: [],
  predicates: [
    { phrase: 'stay upright', signals: ['z'], unit: 'm', margin: (s) => s['z']! - 0.5 },
    { phrase: 'keep its pelvis above {length}', signals: ['z'], unit: 'm', margin: (s, k) => s['z']! - k['length']! },
  ],
};

describe('defect 2: Kiro markup and trailing periods', () => {
  it('compiles a criterion that ends with a period and keeps the source as written', () => {
    const line = 'THE golem SHALL stay upright.';
    const r = compileRequirement(line, lex);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.source).toBe(line);
  });

  it('compiles bold and backtick markup', () => {
    for (const line of [
      'THE **golem** SHALL keep its pelvis above `0.6 m`.',
      '**THE** golem SHALL stay upright',
      'THE __golem__ SHALL stay upright .',
      '`THE golem SHALL stay upright.`',
    ]) {
      const r = compileRequirement(line, lex);
      expect(r.diagnostics, line).toEqual([]);
    }
  });

  it('reports diagnostics at the position in the line as written', () => {
    const line = 'THE **golem** SHALL keep its pelvis above `0.6`.';
    const r = compileRequirement(line, lex);
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('MISSING_UNIT');
    expect(d.start).toBe(line.indexOf('0.6'));
    expect(d.column).toBe(line.indexOf('0.6') + 1);
  });

  it('still rejects a period inside the line', () => {
    const r = compileRequirement('THE golem SHALL stay. upright', lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics[0]!.message).toBe("Unexpected character '.' (U+002E)");
  });

  it('blanks markup without changing the length and keeps underscores inside words', () => {
    const kiroText = (tokenizer as Record<string, unknown>)['kiroText'] as ((s: string) => string) | undefined;
    expect(typeof kiroText).toBe('function');
    expect(kiroText!('keep **pelvis_z** above `1 m`.')).toBe('keep   pelvis_z   above  1 m  ');
    expect(kiroText!('a. b.. ')).toBe('a. b.. ');
  });

  it('extracts and compiles Kiro criteria from a requirements.md', () => {
    const md = [
      '### Requirement 1: Upright',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE golem SHALL stay upright.',
      '2. **WHEN** nothing happens, THE golem SHALL stay upright.',
      '3. THE **golem** SHALL keep its pelvis above `0.6 m`.',
      '4. THE golem SHALL keep its pelvis',
      '   above 0.6 m.',
    ].join('\n');
    expect(extractCriteria(md).criteria.map((c) => c.id)).toEqual(['1.1', '1.2', '1.3', '1.4']);
    const f = compileRequirementsFile(md, lex);
    expect(f.requirements.map((r) => r.id)).toEqual(['1.1', '1.3', '1.4']);
    // 1.2 has no perturbation template: the only diagnostic is about that, not about markup.
    expect(f.diagnostics.map((d) => d.message)).toEqual([
      "The Lexicon has no perturbation template, so 'nothing happens' cannot match.",
    ]);
  });
});
