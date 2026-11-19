// golem-gate-hardening task 9 (defect 7): two rows for one id never pick a winner by position.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbKnownId, arbMark, arbRows, arbStyle, expectedById, tableText, type Mark } from '../../../test/support/table-gen.js';
import { mergeExpectations, parseExpectations, readExpectations, tableErrors } from '../expectation.js';

const T = (rows: string[]): string => `| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n`;

describe('a conflicting duplicate is an error and falls back to Expected_Hold', () => {
  it.each([
    [['| 1.2 | A | Expected_Break |', '| 1.2 | B | Expected_Hold |'], 'Expected_Break at line 3 and Expected_Hold at line 4'],
    [['| 1.2 | A | Expected_Hold |', '| 1.2 | B | Expected_Break |'], 'Expected_Hold at line 3 and Expected_Break at line 4'],
  ])('gives Expected_Hold for %j and names both lines', (rows, words) => {
    const r = parseExpectations(T(rows), 'req.md');
    expect(r.byId.get('1.2')).toBe('Expected_Hold');
    expect(tableErrors(r)).toEqual([{ severity: 'error', file: 'req.md', line: 4, message: `the table gives 1.2 two marks: ${words}` }]);
  });

  it('reports each later row that disagrees with the first, and a later row that agrees only as a warning', () => {
    const r = parseExpectations(T(['| 1.2 | A | Expected_Break |', '| 1.2 | B | Expected_Hold |', '| 1.2 | C | Expected_Break |']));
    expect(r.byId.get('1.2')).toBe('Expected_Hold');
    expect(r.issues.map((i) => [i.severity, i.line])).toEqual([['error', 4], ['warning', 5]]);
  });

  it('is an error across two files, in either order', () => {
    const a = 'a.md';
    const b = 'b.md';
    const brk = T(['| 1.1 | A | Expected_Break |']);
    const hold = T(['| 1.1 | A | Expected_Hold |']);
    for (const [first, second] of [[brk, hold], [hold, brk]] as const) {
      const r = readExpectations({ [a]: first, [b]: second }, [a, b], { reconcile: false });
      expect(r.byId.get('1.1')).toBe('Expected_Hold');
      expect(tableErrors(r)).toHaveLength(1);
      expect(tableErrors(r)[0]?.file).toBe(b);
      expect(tableErrors(r)[0]?.message).toContain('a.md');
    }
  });

  it('keeps the marks of ids that do not conflict when files are merged', () => {
    const r = mergeExpectations([parseExpectations(T(['| 1.1 | A | Expected_Break |'])), parseExpectations(T(['| 2.1 | A | Expected_Break |']))]);
    expect([...r.byId]).toEqual([['1.1', 'Expected_Break'], ['2.1', 'Expected_Break']]);
    expect(r.issues).toEqual([]);
  });
});

describe('a repeated id with the same mark is a warning', () => {
  it('keeps the mark and warns on the later row', () => {
    const r = parseExpectations(T(['| 1.1 | A | Expected_Break |', '| 1.1 | B | Expected_Break |']));
    expect(r.byId.get('1.1')).toBe('Expected_Break');
    expect(r.issues).toEqual([{ severity: 'warning', line: 4, message: '1.1 appears twice in the Expectation table with the same mark; the later row is ignored' }]);
  });
});

describe('an unreadable row and any other row for the same id', () => {
  it('gives Expected_Hold when a readable row follows an unreadable one (probe 1)', () => {
    const r = parseExpectations(T(['| 1.1 | A | oops |', '| 1.1 | B | Expected_Break |']));
    expect(r.byId.get('1.1')).toBe('Expected_Hold');
    expect(tableErrors(r)).toHaveLength(1);
  });

  it('gives Expected_Hold when an unreadable row follows a readable one', () => {
    const r = parseExpectations(T(['| 1.1 | B | Expected_Break |', '| 1.1 | A | oops |']));
    expect(r.byId.get('1.1')).toBe('Expected_Hold');
  });

  it('leaves an id with only unreadable rows out of byId', () => {
    const r = parseExpectations(T(['| 1.1 | A | oops |', '| 1.1 | B | worse |']));
    expect(r.byId.has('1.1')).toBe(false);
    expect(tableErrors(r)).toHaveLength(2);
  });
});

describe('properties', () => {
  it('two different readable marks for one id give Expected_Hold and exactly one error, in both orders and both file orders (property)', () => {
    fc.assert(fc.property(arbKnownId, arbMark, arbStyle, arbStyle, (id, m, s1, s2) => {
      const other: Mark = m === 'Expected_Hold' ? 'Expected_Break' : 'Expected_Hold';
      for (const [x, y] of [[m, other], [other, m]] as const) {
        const one = parseExpectations(tableText([[id, x], [id, y]] as never, s1));
        expect(one.byId.get(id)).toBe('Expected_Hold');
        expect(tableErrors(one)).toHaveLength(1);
        const two = readExpectations({ a: tableText([[id, x]], s1), b: tableText([[id, y]], s2) }, ['a', 'b'], { reconcile: false });
        expect(two.byId.get(id)).toBe('Expected_Hold');
        expect(tableErrors(two)).toHaveLength(1);
      }
    }), { numRuns: 200 });
  });

  it('with one row per id, every id keeps its own mark, whatever the spelling (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbStyle, (rows, style) => {
      const r = parseExpectations(tableText(rows, style));
      expect(r.byId).toEqual(expectedById(rows));
      expect(r.issues).toEqual([]);
    }), { numRuns: 200 });
  });

  it('a mark that is repeated, never contradicted, is kept (property)', () => {
    fc.assert(fc.property(arbKnownId, arbMark, fc.integer({ min: 2, max: 4 }), (id, m, n) => {
      const r = parseExpectations(tableText(Array.from({ length: n }, () => [id, m] as [string, Mark])));
      expect(r.byId.get(id)).toBe(m);
      expect(r.issues).toHaveLength(n - 1);
      expect(r.issues.every((i) => i.severity === 'warning')).toBe(true);
    }), { numRuns: 100 });
  });
});
