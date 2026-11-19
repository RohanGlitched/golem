import { describe, expect, it } from 'vitest';
import { hasError, makeDiagnostic, sortDiagnostics } from '../diagnostics.js';

const pos = (start: number, end = start + 1) => ({ start, end, line: 1, column: start + 1 });

describe('diagnostics', () => {
  it('sorts by ascending start', () => {
    const a = makeDiagnostic('BAD_RANGE', 'a', pos(9));
    const b = makeDiagnostic('BAD_RANGE', 'b', pos(2));
    expect(sortDiagnostics([a, b]).map((d) => d.message)).toEqual(['b', 'a']);
  });

  it('keeps input order for equal starts', () => {
    const ds = ['x', 'y', 'z'].map((m) => makeDiagnostic('UNKNOWN_PHRASE', m, pos(4)));
    expect(sortDiagnostics(ds).map((d) => d.message)).toEqual(['x', 'y', 'z']);
  });

  it('does not mutate its input', () => {
    const ds = [makeDiagnostic('BAD_RANGE', 'a', pos(5)), makeDiagnostic('BAD_RANGE', 'b', pos(1))];
    sortDiagnostics(ds);
    expect(ds[0]!.message).toBe('a');
  });

  it('reports no error for an empty list', () => {
    expect(hasError([])).toBe(false);
  });

  it('reports no error when only warnings are present', () => {
    expect(hasError([makeDiagnostic('NON_EARS_LINE', 'skipped', pos(0))])).toBe(false);
  });

  it('reports an error when any diagnostic has severity error', () => {
    const ds = [makeDiagnostic('NON_EARS_LINE', 'w', pos(0)), makeDiagnostic('MISSING_UNIT', 'e', pos(3))];
    expect(hasError(ds)).toBe(true);
  });

  it('clamps line and column to at least 1 and end to at least start', () => {
    const d = makeDiagnostic('PATTERN_MISMATCH', 'bad', { start: 5, end: 2, line: 0, column: -3 });
    expect(d.line).toBeGreaterThanOrEqual(1);
    expect(d.column).toBeGreaterThanOrEqual(1);
    expect(d.end).toBeGreaterThanOrEqual(d.start);
  });

  it('never produces an empty message and keeps the suggestion', () => {
    const d = makeDiagnostic('UNKNOWN_ROBOT', '', pos(0), { suggestion: 'robot, G1' });
    expect(d.message.length).toBeGreaterThan(0);
    expect(d.suggestion).toBe('robot, G1');
  });
});
