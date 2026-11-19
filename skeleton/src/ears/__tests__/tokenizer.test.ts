import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tokenize } from '../tokenizer.js';

const types = (s: string) => tokenize(s).tokens.map((t) => `${t.type}:${t.text}`);

describe('tokenize', () => {
  it('treats THENCE and IFFY as words, not keywords', () => {
    expect(types('THENCE IFFY')).toEqual(['word:THENCE', 'word:IFFY']);
  });

  it('keeps original spelling of keywords in any case', () => {
    expect(types('When tHe SHALL')).toEqual(['keyword:When', 'keyword:tHe', 'keyword:SHALL']);
  });

  it('prefers m/s over m', () => {
    expect(types('2 m/s')).toEqual(['number:2', 'unit:m/s']);
  });

  it('gives a word for 5 mx, not a unit', () => {
    expect(types('5 mx')).toEqual(['number:5', 'word:mx']);
  });

  it('accepts a unit with no space, and the degree and percent signs', () => {
    expect(types('200N 90° 5 %')).toEqual([
      'number:200', 'unit:N', 'number:90', 'unit:°', 'number:5', 'unit:%',
    ]);
  });

  it('reads signed, fractional and exponent numbers', () => {
    expect(types('-1.5 +2 1e3 0.2')).toEqual(['number:-1.5', 'number:+2', 'number:1e3', 'number:0.2']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(tokenize('')).toEqual({ tokens: [], diagnostics: [] });
    expect(tokenize(' \t\r\n ')).toEqual({ tokens: [], diagnostics: [] });
  });

  it('reports one diagnostic for an illegal character and continues', () => {
    const r = tokenize('THE # robot');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ kind: 'PATTERN_MISMATCH', severity: 'error', start: 4, end: 5, line: 1, column: 5 });
    expect(r.diagnostics[0]!.message).toContain('#');
    expect(r.tokens.map((t) => t.text)).toEqual(['THE', 'robot']);
  });

  it('treats an astral character as one illegal character of two units', () => {
    const r = tokenize('a 😀 b');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ start: 2, end: 4, column: 3 });
    expect(r.tokens[1]).toMatchObject({ text: 'b', start: 5, column: 6 });
  });

  it.each([
    ['R3. THE', 'R3.'],
    ['2. THE', '2.'],
    ['2.1 THE', '2.1'],
  ])('reads %s with requirement ID %s', (input, id) => {
    const t = tokenize(input).tokens;
    expect(t[0]).toMatchObject({ type: 'requirementId', text: id });
    expect(t[1]).toMatchObject({ type: 'keyword', text: 'THE' });
  });

  it('does not read an ID that is not at the start', () => {
    expect(types('THE 2.1')).toEqual(['keyword:THE', 'number:2.1']);
  });

  it('does not read a quantity at the start as an ID', () => {
    expect(types('200 N')).toEqual(['number:200', 'unit:N']);
  });

  it('counts \\r\\n as one break and columns from 1', () => {
    const t = tokenize('  THE\r\n\r\n  SHALL').tokens;
    expect(t[0]).toMatchObject({ line: 1, column: 3, start: 2 });
    expect(t[1]).toMatchObject({ line: 3, column: 3, start: 11 });
  });

  it('attaches commas', () => {
    expect(types('a, b')).toEqual(['word:a', 'comma:,', 'word:b']);
  });
});

describe('tokenize properties', () => {
  const alphabet = ['THE', 'when', 'x', '5', ' ', '  ', '\n', '\r\n', '\t', ',', 'm/s', 'N', '°', '%', '#', '😀', '2.1.', 'R3.', '-', 'é', '.'];
  const inputArb = fc.array(fc.constantFrom(...alphabet), { maxLength: 30 }).map((a) => a.join(''));

  /**
   * Coverage, ordering, offsets and line/column.
   * **Validates: Requirements 1.1, 1.2, 1.8, 1.10**
   */
  it('covers the input, keeps offsets exact and computes line and column independently', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        const { tokens, diagnostics } = tokenize(s);
        const pieces: { start: number; end: number; line: number; column: number }[] = [
          ...tokens, ...diagnostics,
        ];
        pieces.sort((a, b) => a.start - b.start);
        const covered = new Uint8Array(s.length);
        let prevEnd = 0;
        for (const p of pieces) {
          expect(p.start).toBeGreaterThanOrEqual(prevEnd);
          prevEnd = p.end;
          for (let i = p.start; i < p.end; i++) covered[i] = 1;
          const before = s.slice(0, p.start);
          const line = before.split(/\r?\n/).length;
          const column = p.start - (before.lastIndexOf('\n') + 1) + 1;
          expect(p.line).toBe(line);
          expect(p.column).toBe(column);
        }
        for (const t of tokens) expect(s.slice(t.start, t.end)).toBe(t.text);
        for (let i = 0; i < s.length; i++) {
          if (!covered[i]) expect(' \t\r\n').toContain(s[i]!);
        }
      }),
    );
  });

  /** **Validates: Requirements 1.11** */
  it('is deterministic', () => {
    fc.assert(fc.property(inputArb, (s) => {
      expect(tokenize(s)).toEqual(tokenize(s));
    }));
  });

  /** **Validates: Requirements 1.6, 1.7** */
  it('recognises keywords in any case but never inside a longer word', () => {
    const kw = fc.constantFrom('WHEN', 'WHILE', 'IF', 'THEN', 'WHERE', 'THE', 'SHALL');
    fc.assert(
      fc.property(kw, fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }), fc.constantFrom('x', 'ence', 'Z'), (k, flips, tail) => {
        const mixed = [...k].map((ch, i) => (flips[i % 5] ? ch.toLowerCase() : ch)).join('');
        expect(tokenize(mixed).tokens).toMatchObject([{ type: 'keyword', text: mixed }]);
        expect(tokenize(mixed + tail).tokens).toMatchObject([{ type: 'word', text: mixed + tail }]);
      }),
    );
  });
});
