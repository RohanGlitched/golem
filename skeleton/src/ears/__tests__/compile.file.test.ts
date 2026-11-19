import { describe, expect, it } from 'vitest';
import { compileRequirementsFile } from '../compile.js';
import type { Lexicon, PredicateTemplate } from '../types.js';

const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5,
};
const lexicon: Lexicon = { robotNames: ['robot'], predicates: [upright], perturbations: [] };

const file = (...lines: string[]): string => lines.join('\n');

describe('compileRequirementsFile', () => {
  it('keeps every valid requirement in file order when one criterion is invalid', () => {
    const text = file(
      '### Requirement 1',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE robot SHALL stay upright for 3 s',
      '2. THE robot SHALL fly away',
      '3. THE robot SHALL stay upright for 5 s',
    );
    const r = compileRequirementsFile(text, lexicon);
    expect(r.requirements.map((q) => q.id)).toEqual(['1.1', '1.3']);
    expect(r.diagnostics.filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
  });

  it('reports a diagnostic position in file coordinates', () => {
    const text = file(
      '### Requirement 1',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE robot SHALL stay upright for 3 s',
      '2. THE robot SHALL fly away',
    );
    const r = compileRequirementsFile(text, lexicon);
    const d = r.diagnostics.find((x) => x.severity === 'error')!;
    const at = text.indexOf('fly');
    expect(d.line).toBe(6);
    expect(d.column).toBe('2. THE robot SHALL '.length + 1);
    expect(d.start).toBe(at);
    expect(text.slice(d.start, d.end).startsWith('fly')).toBe(true);
  });

  it('maps a diagnostic on a continuation line to that line in the file', () => {
    const text = file(
      '### Requirement 1',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE robot SHALL',
      '    fly away',
    );
    const r = compileRequirementsFile(text, lexicon);
    expect(r.requirements).toEqual([]);
    const d = r.diagnostics.find((x) => x.severity === 'error')!;
    expect(d.line).toBe(6);
    expect(d.column).toBe(5);
    expect(d.start).toBe(text.indexOf('fly'));
  });

  it('adds one warning at the second criterion for a repeated Requirement ID and keeps both', () => {
    const text = file(
      '### Requirement 1',
      '',
      '#### Acceptance Criteria',
      '',
      '1. THE robot SHALL stay upright for 3 s',
      '',
      '1. THE robot SHALL stay upright for 4 s',
    );
    const r = compileRequirementsFile(text, lexicon);
    expect(r.requirements).toHaveLength(2);
    const warns = r.diagnostics.filter((d) => d.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.line).toBe(7);
    expect(warns[0]!.column).toBe(4);
    expect(warns[0]!.message).toContain('1.1');
  });

  it('includes extractor warnings, sorted with compiler diagnostics', () => {
    const text = file(
      '### Requirement 1',
      '',
      '#### Acceptance Criteria',
      '',
      '1. Something that is not EARS',
      '2. THE robot SHALL fly away',
    );
    const r = compileRequirementsFile(text, lexicon);
    expect(r.diagnostics[0]!.kind).toBe('NON_EARS_LINE');
    const starts = r.diagnostics.map((d) => d.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
