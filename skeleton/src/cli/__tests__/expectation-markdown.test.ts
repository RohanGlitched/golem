// golem-gate-hardening task 8 (defect 6): the table is recognised the way Markdown recognises it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbKnownId, arbRows, arbStyle, expectedById, tableLines, tableText, type Mark } from '../../../test/support/table-gen.js';
import { parseExpectations } from '../expectation.js';

const T = (rows: string[], head = '| Criterion | Topic | Expectation |\n|---|---|---|'): string => `${head}\n${rows.join('\n')}\n`;
const ROW = '| 1.2 | Push | Expected_Break |';
const ids = (text: string): string[] => [...parseExpectations(text).byId.keys()];

describe('a table in a fenced code block is an example, not data', () => {
  it.each([
    ['backticks', '```md\n' + T([ROW]) + '```\n'],
    ['tildes', '~~~\n' + T([ROW]) + '~~~\n'],
    ['a longer fence', '````\n' + T([ROW]) + '````\n'],
    ['an indented fence line', '   ```\n' + T([ROW]) + '   ```\n'],
    ['an unclosed fence', '```\n' + T([ROW])],
  ])('skips a table inside %s', (_n, text) => {
    const r = parseExpectations(text);
    expect(r.rows).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.tables).toBe(0);
  });

  it('closes a fence only with the same character and at least as many of it', () => {
    expect(ids('````\n```\n' + T([ROW]) + '````\n')).toEqual([]);
    expect(ids('```\n~~~\n' + T([ROW]) + '```\n')).toEqual([]);
    expect(ids('```\n```\n' + T([ROW]))).toEqual(['1.2']);
    expect(ids('```\n```` \n' + T([ROW]))).toEqual(['1.2']);
  });

  it('reads the real table after an example in a fence', () => {
    const text = '```md\n' + T(['| 1.1 | x | Expected_Break |']) + '```\n\n' + T(['| 1.1 | x | Expected_Hold |', ROW]);
    expect([...parseExpectations(text).byId]).toEqual([['1.1', 'Expected_Hold'], ['1.2', 'Expected_Break']]);
  });

  it('does not take a line with inline triple backticks for a fence', () => {
    expect(ids('```Expected_Break``` is the mark.\n' + T([ROW]))).toEqual(['1.2']);
  });

  it('reports no problem for the rows of a fenced example (no table error, no warning)', () => {
    const r = parseExpectations('```\n' + T(['| 9.9 | x | Expected_Brek |']) + '```\n');
    expect(r.issues).toEqual([]);
  });
});

describe('a table indented 4 spaces or a tab is code, and says so', () => {
  const indent = (text: string, pad: string): string => text.split('\n').map((l) => (l === '' ? l : `${pad}${l}`)).join('\n');

  it.each([['4 spaces', '    '], ['a tab', '\t'], ['5 spaces', '     ']])('ignores a table indented with %s and warns once', (_n, pad) => {
    const r = parseExpectations(indent(T([ROW]), pad));
    expect(r.rows).toEqual([]);
    expect(r.issues).toEqual([{ severity: 'warning', line: 1, message: 'the table at line 1 is indented 4 spaces, which Markdown shows as code; its rows are ignored' }]);
  });

  it('reads a table indented by up to 3 spaces', () => {
    expect(ids(indent(T([ROW]), '   '))).toEqual(['1.2']);
  });
});

describe('header spelling', () => {
  it.each([
    '| Criterion | Topic | Expectation |', '| Criteria | Topic | Expectation |', '| ID | Topic | Expectation |', '| id | Topic | Expectation |',
    '| # | Topic | Expectation |', '| Criterion | Topic | Expectations |', '| Criterion | Topic | Expected |', '| **Criterion** | Topic | `Expectation` |',
    '| CRITERIA | Topic | EXPECTED |',
  ])('reads the rows under %s', (head) => {
    expect(ids(T([ROW], `${head}\n|---|---|---|`))).toEqual(['1.2']);
  });

  it('warns about a header with an Expectation column and no id column, and reads no row', () => {
    for (const head of ['| Requirement | Topic | Expectation |', '| Item | Expected |', '| Topic | Expectations |']) {
      const r = parseExpectations(T([ROW], `${head}\n|---|---|---|`));
      expect(r.rows).toEqual([]);
      expect(r.issues).toEqual([{ severity: 'warning', line: 1, message: 'the table at line 1 has an Expectation column but no Criterion column; its rows are ignored' }]);
    }
  });

  it('does not warn about a table with an id column and no Expectation column (a glossary)', () => {
    expect(parseExpectations('| Criterion | Meaning |\n|---|---|\n| 1.2 | a test |\n').issues).toEqual([]);
  });

  it('does not warn for a body row that mentions Expected_Break in a table without the right header', () => {
    expect(parseExpectations('| Term | Mark |\n|---|---|\n| x | Expected_Break |\n| y | Expected_Hold |\n').issues).toEqual([]);
  });

  it('does not warn when the Expectation-like header has no separator line (not a table)', () => {
    expect(parseExpectations('| Topic | Expectation |\nnot a table\n').issues).toEqual([]);
  });
});

describe('properties', () => {
  const arbFence = fc.record({ ch: fc.constantFrom('`', '~'), n: fc.integer({ min: 3, max: 5 }), info: fc.constantFrom('', 'md', 'markdown'), lead: fc.constantFrom('', ' ', '   ') });

  it('a valid table inside a code fence or indented 4 spaces gives no rows and no error; unwrapped it gives its rows (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbStyle, arbFence, fc.constantFrom('    ', '\t', '      '), (rows, style, f, pad) => {
      fc.pre(rows.length > 0);
      const lines = tableLines(rows, style);
      const fenced = [`${f.lead}${f.ch.repeat(f.n)}${f.info}`, ...lines, `${f.lead}${f.ch.repeat(f.n)}`].join('\n');
      const a = parseExpectations(fenced);
      expect(a.rows).toEqual([]);
      expect(a.issues).toEqual([]);
      const b = parseExpectations(lines.map((l) => `${pad}${l}`).join('\n'));
      expect(b.rows).toEqual([]);
      expect(b.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(parseExpectations(tableText(rows, style)).byId).toEqual(expectedById(rows));
    }), { numRuns: 200 });
  });

  it('every id and expectation alias, in any case, reads its rows; an Expect* header without an id header reads none and warns once (property)', () => {
    const arbId = fc.constantFrom('Criterion', 'Criteria', 'ID', '#', 'criterion', 'CRITERIA', 'id');
    const arbExp = fc.constantFrom('Expectation', 'Expectations', 'Expected', 'EXPECTATION', 'expected');
    const arbOther = fc.constantFrom('Requirement', 'Item', 'Topic', 'Name', 'Row');
    fc.assert(fc.property(arbRows(arbKnownId), arbId, arbExp, arbOther, fc.boolean(), (rows, idH, expH, other, swap) => {
      fc.pre(rows.length > 0);
      const mk = (a: string, b: string): string => (swap ? [`| ${b} | ${a} |`, '|---|---|', ...rows.map(([id, m]) => `| ${m} | ${id} |`)] : [`| ${a} | ${b} |`, '|---|---|', ...rows.map(([id, m]) => `| ${id} | ${m} |`)]).join('\n');
      expect(parseExpectations(mk(idH, expH)).byId).toEqual(expectedById(rows as [string, Mark][]));
      const none = parseExpectations(mk(other, expH));
      expect(none.rows).toEqual([]);
      expect(none.issues).toHaveLength(1);
      expect(none.issues[0]?.severity).toBe('warning');
    }), { numRuns: 200 });
  });
});
