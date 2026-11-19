import { describe, it, expect } from 'vitest';
import { parseQuantity, quantityFromTokens, ACCEPTED_UNITS } from '../units.js';
import { tokenize } from '../tokenizer.js';

describe('parseQuantity', () => {
  it('rejects a force without a unit', () => {
    const r = parseQuantity('200');
    expect(r.quantity).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('MISSING_UNIT');
    expect(d.severity).toBe('error');
    expect(d.line).toBe(1);
    expect(d.column).toBe(1);
  });

  it('keeps the written spelling of 0.20 s', () => {
    const r = parseQuantity('0.20 s');
    expect(r.diagnostics).toEqual([]);
    expect(r.quantity).toEqual({ kind: 'duration', si: 0.2, text: '0.20 s' });
  });

  it('accepts a unit glued to the number and keeps the text', () => {
    expect(parseQuantity('200N').quantity).toEqual({ kind: 'force', si: 200, text: '200N' });
    expect(parseQuantity('90 °').quantity?.text).toBe('90 °');
  });

  it('converts kN to newtons', () => {
    expect(parseQuantity('2 kN').quantity?.si).toBe(2000);
  });

  it('rejects a ratio of 1.5 with BAD_RANGE stating the interval', () => {
    const r = parseQuantity('1.5', 'ratio');
    expect(r.quantity).toBeUndefined();
    expect(r.diagnostics[0]?.kind).toBe('BAD_RANGE');
    expect(r.diagnostics[0]?.message).toContain('[0, 1]');
  });

  it('accepts a bare ratio in [0, 1] and a percentage', () => {
    expect(parseQuantity('0.5', 'ratio').quantity).toEqual({ kind: 'ratio', si: 0.5, text: '0.5' });
    expect(parseQuantity('50 %', 'ratio').quantity?.si).toBeCloseTo(0.5, 15);
  });

  it('accepts an unsigned integer count', () => {
    expect(parseQuantity('3', 'count').quantity).toEqual({ kind: 'count', si: 3, text: '3' });
  });

  it('rejects a fractional or signed count', () => {
    expect(parseQuantity('2.5', 'count').diagnostics[0]?.kind).toBe('BAD_RANGE');
    expect(parseQuantity('-3', 'count').diagnostics[0]?.kind).toBe('BAD_RANGE');
  });

  it('rejects an unknown unit word listing the accepted units', () => {
    const r = parseQuantity('5 mx');
    expect(r.quantity).toBeUndefined();
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe('UNKNOWN_PHRASE');
    expect(d.column).toBe(3);
    for (const u of ACCEPTED_UNITS) expect(d.message).toContain(u);
  });

  it('rejects text that is not a number', () => {
    expect(parseQuantity('abc').diagnostics[0]?.kind).toBe('PATTERN_MISMATCH');
  });
});

describe('quantityFromTokens', () => {
  it('builds a quantity from tokenizer output', () => {
    const { tokens } = tokenize('WHEN pushed with 200 N');
    const i = tokens.findIndex((t) => t.type === 'number');
    const r = quantityFromTokens(tokens[i]!, tokens[i + 1], 'force');
    expect(r.quantity).toEqual({ kind: 'force', si: 200, text: '200 N' });
  });

  it('reports MISSING_UNIT at the number position when a word follows', () => {
    const { tokens } = tokenize('push with 200 hard');
    const i = tokens.findIndex((t) => t.type === 'number');
    const r = quantityFromTokens(tokens[i]!, undefined, 'force');
    expect(r.diagnostics[0]).toMatchObject({ kind: 'MISSING_UNIT', line: 1, column: 11 });
  });

  it('does not report a kind mismatch itself', () => {
    const { tokens } = tokenize('3 s');
    const r = quantityFromTokens(tokens[0]!, tokens[1], 'force');
    expect(r.diagnostics).toEqual([]);
    expect(r.quantity?.kind).toBe('duration');
  });
});
