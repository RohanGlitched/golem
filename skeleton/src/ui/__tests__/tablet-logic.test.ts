import { describe, expect, it } from 'vitest';
import { compileRequirement, extractCriteria } from '../../ears/index.js';
import { segmentLine } from '../tablet/segments.js';
import { commitTyped, dragQuantity, effectiveStep, formatSpan, rangeOf, rewriteSpan, stepDecimals, stepQuantity } from '../tablet/quantity-edit.js';
import { diagnosticLabel, underlineRanges } from '../tablet/diagnostics-view.js';
import { GOOD_LINE, testLexicon } from './generators/lexicon.js';
import type { DiagnosticKind } from '../../ears/index.js';

describe('segmentLine', () => {
  it('splits WHEN ... with up to 200 N ... into keyword, quantity and plain segments', () => {
    const line = 'WHEN the pelvis is pushed with up to 200 N for 0.2 s THE robot SHALL stay upright';
    const segs = segmentLine(line);
    expect(segs.map((s) => s.text).join('')).toBe(line);
    expect(segs.filter((s) => s.kind === 'keyword').map((s) => s.text)).toEqual(['WHEN', 'THE', 'SHALL']);
    const q = segs.filter((s) => s.kind === 'quantity');
    expect(q.map((s) => s.text)).toEqual(['200 N', '0.2 s']);
    expect(q[0]!.q).toMatchObject({ kind: 'force', unit: 'N', gap: ' ', value: 200, decimals: 0, inheritedUnit: false });
    expect(q[1]!.q).toMatchObject({ kind: 'duration', unit: 's', decimals: 1 });
  });
  it('lets the first number of a range inherit the unit', () => {
    const segs = segmentLine('IF it is pushed with 150 to 250 N THEN THE robot SHALL fall');
    const q = segs.filter((s) => s.kind === 'quantity');
    expect(q.map((s) => s.text)).toEqual(['150', '250 N']);
    expect(q[0]!.q).toMatchObject({ unit: 'N', inheritedUnit: true, gap: '' });
  });
  it('keeps a number with no unit as plain text', () => {
    const segs = segmentLine('WHEN pushed with 200 for 3 s THE robot SHALL hold');
    expect(segs.filter((s) => s.kind === 'quantity').map((s) => s.text)).toEqual(['3 s']);
  });
});

describe('quantity edits', () => {
  const force = segmentLine('with 200 N')[1]!.q!;
  it('steps by the unit step, times 10 with Shift and 0.1 with Alt', () => {
    const r = rangeOf('force', 'N');
    expect(stepQuantity(200, 'N', 1, 'none', r, 0)).toBe(201);
    expect(stepQuantity(200, 'N', 1, 'shift', r, 0)).toBe(210);
    expect(stepQuantity(200, 'N', -1, 'alt', r, 0)).toBe(199.9);
    expect(stepQuantity(0, 'N', -1, 'none', r, 0)).toBe(0);
  });
  it('removes binary noise when stepping 0.1 s three times', () => {
    const r = rangeOf('duration', 's');
    let v = 0;
    for (let i = 0; i < 3; i++) v = stepQuantity(v, 's', 1, 'none', r, 1);
    expect(v).toBe(0.3);
  });
  it('drags one step per 4 px', () => {
    expect(dragQuantity(200, 9, 'N', 'none', rangeOf('force', 'N'), 0)).toBe(202);
    expect(dragQuantity(200, -7, 'N', 'none', rangeOf('force', 'N'), 0)).toBe(199);
    expect(dragQuantity(50, 40, '%', 'none', rangeOf('ratio', '%'), 0)).toBe(60);
    expect(dragQuantity(98, 40, '%', 'none', rangeOf('ratio', '%'), 0)).toBe(100);
  });
  it('rewrites only the span with the written gap and unit', () => {
    const line = 'with 200 N now';
    expect(rewriteSpan(line, 5, 10, formatSpan(force, 168, 0))).toBe('with 168 N now');
    const glued = segmentLine('for 0.2s')[1]!.q!;
    expect(formatSpan(glued, 0.35, 2)).toBe('0.35s');
  });
  it('rejects a force typed with a time unit', () => {
    const r = commitTyped('200 s', force, rangeOf('force', 'N'));
    expect(r).toEqual({ ok: false, message: 'Write a force: 200 N, not 200 s' });
  });
  it('uses the original unit when none is typed and converts a unit of the same kind', () => {
    expect(commitTyped('150', force, rangeOf('force', 'N'))).toEqual({ ok: true, value: 150, clamped: false });
    expect(commitTyped('0.25 kN', force, rangeOf('force', 'N'))).toEqual({ ok: true, value: 250, clamped: false });
    expect(commitTyped('-5', force, rangeOf('force', 'N'))).toEqual({ ok: true, value: 0, clamped: true });
  });
});

describe('diagnostics view', () => {
  const cases: [DiagnosticKind, string][] = [
    ['PATTERN_MISMATCH', 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE robot keep the bob within 0.3 rad'],
    ['MISSING_UNIT', 'WHEN the bob is pushed with up to 20 for 0.2 s from any direction THE robot SHALL keep the bob within 0.3 rad'],
    ['UNKNOWN_PHRASE', 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE robot SHALL dance a jig'],
    ['BAD_RANGE', 'WHEN the bob is pushed with 30 to 20 N for 0.2 s from any direction THE robot SHALL keep the bob within 0.3 rad'],
    ['UNKNOWN_ROBOT', 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE toaster SHALL keep the bob within 0.3 rad'],
  ];
  it('compiles the reference line without diagnostics', () => {
    expect(compileRequirement(GOOD_LINE, testLexicon).diagnostics).toEqual([]);
  });
  for (const [kind, line] of cases) {
    it(`shows kind, line and column of a ${kind} diagnostic and underlines it`, () => {
      const { diagnostics } = compileRequirement(line, testLexicon, { id: '1.1' });
      const d = diagnostics.find((x) => x.kind === kind);
      expect(d, `kinds: ${diagnostics.map((x) => x.kind).join(',')}`).toBeDefined();
      const label = diagnosticLabel(d!);
      expect(label).toContain(kind);
      expect(label).toContain(`Line ${d!.line}`);
      expect(label).toContain(`column ${d!.column}`);
      const ranges = underlineRanges(line, [d!]);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]!.start).toBe(Math.min(d!.start, line.length - 1));
      expect(ranges[0]!.end).toBeGreaterThan(ranges[0]!.start);
      expect(ranges[0]!.end).toBeLessThanOrEqual(line.length);
    });
  }
  it('shows kind, line and column of a NON_EARS_LINE diagnostic from the file and underlines it', () => {
    const md = '### Requirement 1: Bob\n\n#### Acceptance Criteria\n\n1. Bob should be fine.\n';
    const { diagnostics } = extractCriteria(md);
    const d = diagnostics.find((x) => x.kind === 'NON_EARS_LINE')!;
    expect(d).toBeDefined();
    const label = diagnosticLabel(d);
    expect(label).toContain('NON_EARS_LINE');
    expect(label).toContain('Line 5');
    expect(label).toContain('column 4');
    expect(underlineRanges(md, [d])).toEqual([{ start: d.start, end: d.end }]);
  });
  it('clamps, sorts and merges ranges', () => {
    expect(underlineRanges('abcdef', [{ start: 4, end: 99 }, { start: -3, end: 2 }, { start: 1, end: 3 }, { start: 5, end: 5 }]))
      .toEqual([{ start: 0, end: 3 }, { start: 4, end: 6 }]);
  });
});

describe('effectiveStep', () => {
  it('has no binary noise: 0.1 of a 0.05 step is exactly 0.005, so stepping 16 rad with alt returns to 16', () => {
    expect(effectiveStep('rad', 'alt')).toBe(0.005);
    expect(effectiveStep('kg', 'alt')).toBe(0.01);
    expect(effectiveStep('m/s', 'alt')).toBe(0.005);
    expect(stepDecimals('rad', 'alt', 0)).toBe(3);
    const up = stepQuantity(16, 'rad', 1, 'alt', { min: -Infinity, max: Infinity }, 0);
    expect(stepQuantity(up, 'rad', -1, 'alt', { min: -Infinity, max: Infinity }, 0)).toBe(16);
  });
});
