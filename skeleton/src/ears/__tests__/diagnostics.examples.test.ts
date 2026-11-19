import { describe, expect, it } from 'vitest';
// Public entry point of the module (Requirement 12.14).
import { compileRequirement, compileRequirementsFile, extractCriteria } from '../index.js';
import type { Dimension, Lexicon, PerturbationTemplate, PredicateTemplate } from '../index.js';

// Small hand-written, stagger-like Lexicon.
const push: PerturbationTemplate = {
  phrase: 'the pelvis is pushed with {range:force} for {duration} from {direction}',
  dims: (s) => {
    const f = s['force'] as [{ si: number }, { si: number }];
    const dims: Dimension[] = [
      { name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' },
    ];
    if (s['direction'] === 'any direction') {
      dims.push({ name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true });
    }
    return dims;
  },
  apply: () => {},
};
const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5,
};
const above: PredicateTemplate = {
  phrase: 'keep its pelvis above {length}', signals: ['h'], unit: 'm', margin: (s, slots) => s['h']! - slots['length']!,
};
const lexicon: Lexicon = {
  robotNames: ['robot', 'golem', 'G1'], predicates: [upright, above], perturbations: [push],
};

const PUSH = 'the pelvis is pushed with up to 200 N for 0.2 s from any direction';

describe('Diagnostic kinds reported through the public entry point', () => {
  it('reports PATTERN_MISMATCH at the end of a line that has no SHALL after its trigger', () => {
    const line = `WHEN ${PUSH} THE robot stay upright`;
    const r = compileRequirement(line, lexicon);
    expect(r.requirement).toBeUndefined();
    const d = r.diagnostics.find((x) => x.kind === 'PATTERN_MISMATCH');
    expect(d).toBeDefined();
    expect(d!.line).toBe(1);
    // No SHALL follows the trigger, so the missing keyword is reported at the end of the line.
    expect(d!.column).toBe(line.length + 1);
  });

  it('rejects a force without a unit', () => {
    const line = `WHEN the pelvis is pushed with up to 200 for 0.2 s from any direction THE robot SHALL stay upright for 3 s`;
    const r = compileRequirement(line, lexicon);
    expect(r.requirement).toBeUndefined();
    const d = r.diagnostics.find((x) => x.kind === 'MISSING_UNIT');
    expect(d).toBeDefined();
    expect(d!.line).toBe(1);
    expect(d!.column).toBe(line.indexOf('200') + 1);
  });

  it('rejects a phrase the Lexicon does not contain at its first unmatched word', () => {
    const line = 'WHEN the pelvis is poked with up to 200 N THE robot SHALL stay upright for 3 s';
    const r = compileRequirement(line, lexicon);
    expect(r.requirement).toBeUndefined();
    const d = r.diagnostics.find((x) => x.kind === 'UNKNOWN_PHRASE');
    expect(d).toBeDefined();
    expect(d!.line).toBe(1);
    expect(d!.column).toBe(line.indexOf('poked') + 1);
  });

  it('rejects a range whose minimum exceeds its maximum at the second quantity', () => {
    const line = 'WHEN the pelvis is pushed with 250 N to 150 N for 0.2 s from any direction THE robot SHALL stay upright for 3 s';
    const r = compileRequirement(line, lexicon);
    expect(r.requirement).toBeUndefined();
    const d = r.diagnostics.find((x) => x.kind === 'BAD_RANGE');
    expect(d).toBeDefined();
    expect(d!.line).toBe(1);
    expect(d!.column).toBe(line.indexOf('150 N') + 1);
  });

  it('rejects a robot name that is not in the Lexicon at the name', () => {
    const line = 'THE human SHALL stay upright';
    const r = compileRequirement(line, lexicon);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ kind: 'UNKNOWN_ROBOT', line: 1, column: 5 });
  });

  it('reports a file line that is not EARS as a NON_EARS_LINE warning at the right line and column', () => {
    const file = [
      '### Requirement 1: Push recovery',
      '',
      '#### Acceptance Criteria',
      '',
      '1. Robots should be nice',
      '2. THE robot SHALL stay upright',
      '',
    ].join('\n');
    const r = compileRequirementsFile(file, lexicon);
    const d = r.diagnostics.find((x) => x.kind === 'NON_EARS_LINE');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.line).toBe(5);
    expect(d!.column).toBe(4);
    expect(r.requirements.map((q) => q.id)).toEqual(['1.2']);
  });

  it('reports a diagnostic from a later file line in file coordinates', () => {
    const file = [
      '### Requirement 2: Humans',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE robot SHALL stay upright',
      '2. THE human SHALL stay upright',
      '',
    ].join('\n');
    const r = compileRequirementsFile(file, lexicon);
    expect(r.requirements.map((q) => q.id)).toEqual(['2.1']);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ kind: 'UNKNOWN_ROBOT', line: 6, column: 8 });
  });
});

describe('Kiro-style requirements.md', () => {
  const withComma = `WHEN ${PUSH}, THE robot SHALL stay upright for 3 s`;
  const withoutComma = `WHEN ${PUSH} THE robot SHALL stay upright for 3 s`;
  const file = [
    '# Requirements Document',
    '',
    '### Requirement 1: Push recovery',
    '',
    '**User Story:** As an engineer, I want push recovery.',
    '',
    '#### Acceptance Criteria',
    '',
    `1. ${withComma}`,
    `2. ${withoutComma}`,
    '3. THE robot SHALL stay upright',
    '',
  ].join('\n');

  it('extracts ids, texts, lines and columns for lines with and without the comma before THE', () => {
    const { criteria, diagnostics } = extractCriteria(file);
    expect(diagnostics).toEqual([]);
    expect(criteria.map((c) => c.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(criteria.map((c) => c.text)).toEqual([withComma, withoutComma, 'THE robot SHALL stay upright']);
    expect(criteria.map((c) => c.line)).toEqual([9, 10, 11]);
    expect(criteria.map((c) => c.column)).toEqual([4, 4, 4]);
  });

  it('compiles both comma forms to requirements with the same ids and the same behaviour', () => {
    const r = compileRequirementsFile(file, lexicon);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirements.map((q) => q.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(r.requirements.map((q) => q.source)).toEqual([withComma, withoutComma, 'THE robot SHALL stay upright']);
    const [a, b] = r.requirements;
    expect(a!.pattern).toBe('event');
    expect(a!.space).toEqual(b!.space);
    expect(a!.perturbations).toEqual(b!.perturbations);
    expect(a!.horizon).toBe(b!.horizon);
  });
});
