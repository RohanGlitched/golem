// golem-gate-hardening task 3 (defect 1): the table is compared with the criteria that exist.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RED_REQUIREMENTS } from '../../../test/support/harness.js';
import { TINY_IDS, arbMark, arbRows, arbKnownId, arbUnknownId, tableText } from '../../../test/support/table-gen.js';
import { formatIssue, nearestId, parseExpectations, readExpectations, reconcileExpectations, tableErrors } from '../expectation.js';

const refs = (ids: readonly string[], file?: string) => ids.map((id, i) => ({ id, line: 10 + i, ...(file !== undefined ? { file } : {}) }));
const table = (rows: string[]): string => `| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n`;

describe('nearestId', () => {
  const ids = ['1.1', '1.2', '1.3', '2.1'];

  it.each([
    ['R1.2', '1.2'], ['1.2.', '1.2'], ['Req 1.3', '1.3'], ['Requirement 2.1', '2.1'], ['r1.1', '1.1'], ['1.20', '1.2'], ['2.11', '2.1'],
  ])('suggests %s -> %s', (written, want) => {
    expect(nearestId(written, ids)).toBe(want);
  });

  it('gives no suggestion when two ids are equally near, or none is near', () => {
    expect(nearestId('1.9', ids)).toBeUndefined();
    expect(nearestId('1.4 and 1.5', ids)).toBeUndefined();
    expect(nearestId('7.7', ids)).toBeUndefined();
  });

  it('returns an id that exists as it is', () => {
    for (const id of ids) expect(nearestId(id, ids)).toBe(id);
  });

  it('is undefined or an element of ids, and the identity on every id (property)', () => {
    fc.assert(fc.property(fc.string({ maxLength: 8 }), fc.uniqueArray(arbKnownId, { maxLength: 3 }), (written, some) => {
      const r = nearestId(written, some);
      expect(r === undefined || some.includes(r)).toBe(true);
      for (const id of some) expect(nearestId(id, some)).toBe(id);
    }), { numRuns: 200 });
  });
});

describe('reconcileExpectations', () => {
  it.each(['R1.2', '1.20', '1.2.', 'Req 1.3', '1.4 and 1.5', '9.9'])('is an error when the table marks %s, which no requirement has', (id) => {
    const r = reconcileExpectations(parseExpectations(table([`| ${id} | x | Expected_Break |`]), 'req.md'), refs(TINY_IDS));
    const errors = tableErrors(r);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ severity: 'error', file: 'req.md', line: 3 });
    expect(errors[0]?.message).toContain(`the table marks ${id}, but no requirement has that id`);
  });

  it('names the nearest id', () => {
    const r = reconcileExpectations(parseExpectations(table(['| 1.20 | x | Expected_Break |'])), refs(TINY_IDS));
    expect(tableErrors(r)[0]?.message).toBe('the table marks 1.20, but no requirement has that id (did you mean 1.2?)');
    expect(formatIssue(tableErrors(r)[0] as never)).toBe('line 3: error: the table marks 1.20, but no requirement has that id (did you mean 1.2?)');
  });

  it('warns about a line with no row only when a table exists, naming its place', () => {
    const withTable = reconcileExpectations(parseExpectations(table(['| 1.1 | x | Expected_Hold |']), 'req.md'), refs(TINY_IDS, 'req.md'));
    expect(withTable.issues).toEqual([
      { severity: 'warning', file: 'req.md', line: 11, message: '1.2 has no row in the Expectation table, so it is Expected_Hold' },
      { severity: 'warning', file: 'req.md', line: 12, message: '1.3 has no row in the Expectation table, so it is Expected_Hold' },
    ]);
    const none = reconcileExpectations(parseExpectations('# Requirements\n'), refs(TINY_IDS));
    expect(none.issues).toEqual([]);
  });

  it('counts a row with an unreadable mark as a row for that line', () => {
    const r = reconcileExpectations(parseExpectations(table(['| 1.1 | x | Expected_Brek |', '| 1.2 | x | Expected_Hold |', '| 1.3 | x | Expected_Hold |'])), refs(TINY_IDS));
    expect(r.issues.filter((i) => i.severity === 'warning')).toEqual([]);
    expect(tableErrors(r)).toHaveLength(1);
  });

  it('takes the ids from the extractor, so a line that does not compile has no orphan row', () => {
    const text = `${table(['| 1.1 | x | Expected_Hold |', '| 1.2 | x | Expected_Break |'])}\n### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n2. THE robot SHALL not compile this either\n`;
    const r = readExpectations({ f: text }, ['f']);
    expect(tableErrors(r)).toEqual([]);
  });

  it('reads the real Tiny file: three criteria, no table, no issue', () => {
    expect(readExpectations({ f: RED_REQUIREMENTS }, ['f']).issues).toEqual([]);
  });

  it('adds a row for an unknown id as exactly one error and leaves the other marks alone (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbUnknownId, arbMark, (rows, unknown, mark) => {
      fc.pre(rows.length > 0);
      const base = reconcileExpectations(parseExpectations(tableText(rows)), refs(TINY_IDS));
      const more = reconcileExpectations(parseExpectations(tableText([...rows, [unknown, mark]])), refs(TINY_IDS));
      expect(tableErrors(base)).toHaveLength(0);
      expect(tableErrors(more)).toHaveLength(1);
      expect(tableErrors(more)[0]?.message).toContain(unknown);
      for (const [id] of rows) expect(more.byId.get(id)).toBe(base.byId.get(id));
    }), { numRuns: 200 });
  });

  it('gives an error for no row whose id exists, whatever the marks (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), (rows) => {
      const r = reconcileExpectations(parseExpectations(tableText(rows)), refs(TINY_IDS));
      expect(tableErrors(r)).toEqual([]);
      const unmarked = TINY_IDS.filter((id) => !rows.some(([x]) => x === id));
      expect(r.issues.filter((i) => i.severity === 'warning')).toHaveLength(unmarked.length);
    }), { numRuns: 200 });
  });
});
