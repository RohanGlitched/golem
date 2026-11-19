// Regression test for defect 3: a borrowed unit doubled the first number in the range text.
import { describe, expect, it } from 'vitest';
import { parseRangePhrase } from '../ranges.js';
import { tokenize } from '../tokenizer.js';

const range = (text: string) => parseRangePhrase(tokenize(text).tokens, 0);

describe('defect 3: range text with a borrowed unit', () => {
  it('keeps "150 to 250 N" as written', () => {
    const r = range('150 to 250 N');
    expect(r.diagnostics).toEqual([]);
    expect(r.range).toEqual({
      kind: 'force', min: 150, max: 250, wrap: false, fixed: false, text: '150 to 250 N',
      span: { start: 0, end: 12, line: 1, column: 1 },
    });
  });

  it('keeps the spacing of "150 to  250 N" and of "150 N to 250 N"', () => {
    expect(range('150 to  250 N').range!.text).toBe('150 to  250 N');
    expect(range('150 N to 250 N').range!.text).toBe('150 N to 250 N');
    expect(range('up to 200 N').range!.text).toBe('up to 200 N');
  });
});
