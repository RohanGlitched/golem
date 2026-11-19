import { describe, it, expect } from 'vitest';
import { parseRangePhrase, rangeToDimension, duplicateRangeDiagnostic } from '../ranges.js';
import { tokenize } from '../tokenizer.js';

const parse = (s: string) => parseRangePhrase(tokenize(s).tokens, 0);
// A leading `0.2` would read as a requirement ID, so lone values are parsed after `for`.
const parseAfterFor = (s: string) => parseRangePhrase(tokenize('for ' + s).tokens, 1);

describe('parseRangePhrase', () => {
  it('parses up to 200 N as force 0 to 200', () => {
    const r = parse('up to 200 N');
    expect(r.diagnostics).toEqual([]);
    expect(r.range).toMatchObject({ kind: 'force', min: 0, max: 200, wrap: false, fixed: false });
    expect(r.next).toBe(4);
  });

  it('accepts up to 0 N as a valid fixed range', () => {
    const r = parse('up to 0 N');
    expect(r.diagnostics).toEqual([]);
    expect(r.range).toMatchObject({ kind: 'force', min: 0, max: 0, fixed: true });
  });

  it('parses 150 to 250 N and equal bounds', () => {
    expect(parse('150 to 250 N').range).toMatchObject({ min: 150, max: 250 });
    const eq = parse('5 N to 5 N');
    expect(eq.diagnostics).toEqual([]);
    expect(eq.range).toMatchObject({ min: 5, max: 5, fixed: true });
  });

  it('gives from any direction as 0 to 2π wrapping', () => {
    expect(parse('from any direction').range).toMatchObject({
      kind: 'angle', min: 0, max: 2 * Math.PI, wrap: true,
    });
  });

  it('gives from behind as 3π/4 to 5π/4 wrapping', () => {
    expect(parse('from behind').range).toMatchObject({
      kind: 'angle', min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4, wrap: true,
    });
  });

  it('gives at any point in its stride as phase 0 to 1 wrapping', () => {
    const r = parse('at any point in its stride');
    expect(r.range).toMatchObject({ kind: 'phase', min: 0, max: 1, wrap: true });
    expect(r.next).toBe(6);
  });

  it('gives a lone quantity as a fixed value', () => {
    const r = parseAfterFor('0.2 s');
    expect(r.range).toMatchObject({ kind: 'duration', min: 0.2, max: 0.2, fixed: true });
  });

  it('rejects min greater than max at the second quantity with line and column', () => {
    const r = parse('250 N to 150 N');
    expect(r.range).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('BAD_RANGE');
    expect(d.line).toBe(1);
    expect(d.column).toBe(10);
    expect(d.message).toContain('250 N');
    expect(d.message).toContain('150 N');
  });

  it('rejects mixed kinds at the second quantity naming both kinds', () => {
    const r = parse('5 N to 3 s');
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('BAD_RANGE');
    expect(d.column).toBe(8);
    expect(d.message).toContain('force');
    expect(d.message).toContain('duration');
  });

  it('rejects a negative force at the quantity', () => {
    const r = parse('up to -5 N');
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('BAD_RANGE');
    expect(d.column).toBe(7);
    expect(d.message).toContain('force');
    expect(d.message).toContain('-5 N');
  });

  it('returns no range and consumes nothing for an unrelated token', () => {
    const r = parse('pushed');
    expect(r.range).toBeUndefined();
    expect(r.next).toBe(0);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('rangeToDimension', () => {
  it('copies kind, bounds, severity and wrap', () => {
    const d = rangeToDimension('push.angle', parse('from any direction').range!, 'none');
    expect(d).toEqual({ name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true });
  });

  it('sets min equal to max for a fixed value and omits wrap', () => {
    const d = rangeToDimension('push.duration', parseAfterFor('0.2 s').range!, 'none');
    expect(d.min).toBe(d.max);
    expect(d.wrap).toBeUndefined();
  });
});

describe('duplicateRangeDiagnostic', () => {
  it('reports BAD_RANGE at the second range', () => {
    const second = parse('up to 5 N').range!;
    const d = duplicateRangeDiagnostic('force', second);
    expect(d.kind).toBe('BAD_RANGE');
    expect(d.column).toBe(1);
  });
});
