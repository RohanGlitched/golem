import { describe, expect, it } from 'vitest';
import { extractCriteria } from '../extract.js';

const FILE = [
  '# Requirements',
  '',
  '### Requirement 1: Push recovery',
  '',
  '**User Story:** As a user.',
  '',
  '#### Acceptance Criteria',
  '',
  '1. WHEN the pelvis is pushed with up to 200 N for 0.2 s, THE robot SHALL stay upright for 3 s',
  '2) WHEN the pelvis is pushed with up to 100 N for 0.2 s THE robot SHALL',
  '   stay upright for 3 s',
  '- a bullet',
  '* another bullet',
  '3. FOR ALL traces the robot is fine',
  '4. A pelvis is red',
  '5. THE robot SHALL keep its pelvis above 0.4 m',
  '',
  '### Requirement 2: Other',
  '#### Acceptance Criteria',
  '1. while the robot walks, THE robot SHALL stay upright for 3 s',
  '',
].join('\n');

describe('extractCriteria', () => {
  it('returns ids, texts, lines, columns and offsets for a Kiro-style file', () => {
    const { criteria } = extractCriteria(FILE);
    expect(criteria.map((c) => c.id)).toEqual(['1.1', '1.2', '1.5', '2.1']);
    expect(criteria[0]!.text).toBe(
      'WHEN the pelvis is pushed with up to 200 N for 0.2 s, THE robot SHALL stay upright for 3 s',
    );
    expect(criteria[0]!.line).toBe(9);
    expect(criteria[0]!.column).toBe(4);
    expect(FILE.slice(criteria[0]!.offset, criteria[0]!.offset + 4)).toBe('WHEN');
    expect(criteria[1]!.column).toBe(4);
    expect(criteria[1]!.line).toBe(10);
    expect(criteria[3]!.text.startsWith('while')).toBe(true);
  });

  it('joins indented continuation lines with one space and records an offset map', () => {
    const c = extractCriteria(FILE).criteria[1]!;
    expect(c.text).toBe(
      'WHEN the pelvis is pushed with up to 100 N for 0.2 s THE robot SHALL stay upright for 3 s',
    );
    expect(c.segments).toHaveLength(2);
    const seg = c.segments[1]!;
    expect(seg.line).toBe(11);
    expect(seg.column).toBe(4);
    expect(c.text.slice(seg.textIndex, seg.textIndex + 4)).toBe('stay');
    expect(FILE.slice(seg.offset, seg.offset + 4)).toBe('stay');
  });

  it('warns on non-EARS and FOR ALL lines and skips them', () => {
    const { diagnostics } = extractCriteria(FILE);
    expect(diagnostics.map((d) => [d.kind, d.severity, d.line, d.column])).toEqual([
      ['NON_EARS_LINE', 'warning', 14, 4],
      ['NON_EARS_LINE', 'warning', 15, 4],
    ]);
  });

  it('gives the same result for CRLF and LF', () => {
    const lf = extractCriteria(FILE);
    const crlf = extractCriteria(FILE.replace(/\n/g, '\r\n'));
    const pick = (r: typeof lf) => r.criteria.map((c) => [c.id, c.text, c.line, c.column]);
    expect(pick(crlf)).toEqual(pick(lf));
    expect(crlf.diagnostics.map((d) => [d.line, d.column])).toEqual(lf.diagnostics.map((d) => [d.line, d.column]));
  });

  it('returns an empty list when there is no acceptance criteria heading', () => {
    const r = extractCriteria('### Requirement 1\n1. THE robot SHALL stand\n');
    expect(r.criteria).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(extractCriteria('')).toEqual({ criteria: [], diagnostics: [] });
  });

  it('uses R0 and one warning for a criterion before any requirement heading', () => {
    const r = extractCriteria('#### Acceptance Criteria\n1. THE robot SHALL stand\n');
    expect(r.criteria.map((c) => c.id)).toEqual(['R0.1']);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', line: 2, column: 1 });
  });

  it('ends the section at a heading and a criterion at a blank line', () => {
    const r = extractCriteria(
      '### Requirement 3\n#### Acceptance Criteria\n1. THE robot SHALL stand\n\n   not joined\n## Next\n2. THE robot SHALL sit\n',
    );
    expect(r.criteria.map((c) => c.text)).toEqual(['THE robot SHALL stand']);
  });
});
