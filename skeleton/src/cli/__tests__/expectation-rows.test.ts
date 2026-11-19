// golem-gate-hardening task 10 (defect 10): how rows are cut, and what the JSON output carries.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { arbKnownId, arbRows, arbStyleWide, expectedById, tableText, type Mark } from '../../../test/support/table-gen.js';
import { parseExpectations, tableErrors } from '../expectation.js';

const HEAD = '| Criterion | Topic | Expectation |\n|---|---|---|\n';
const ids = (text: string): [string, string][] => [...parseExpectations(text).byId];

describe('cells', () => {
  it('reads an escaped pipe as a character of the cell, not a column break', () => {
    const r = parseExpectations(`${HEAD}| 1.1 | A \\| B | Expected_Break |\n| 1.2 | x \\|\\| y | Expected_Hold |\n`);
    expect([...r.byId]).toEqual([['1.1', 'Expected_Break'], ['1.2', 'Expected_Hold']]);
    expect(r.issues).toEqual([]);
  });

  it('keeps splitting on a pipe inside backticks, as GitHub does (a pipe there must be escaped)', () => {
    const r = parseExpectations(`${HEAD}| 1.1 | \`a|b\` | Expected_Break |\n`);
    expect(tableErrors(r)).toHaveLength(1);
    expect(tableErrors(r)[0]?.message).toContain('the expectation of 1.1 is "b"');
  });

  it('reads a row whose last pipe is escaped as one that continues', () => {
    expect(ids(`${HEAD}| 1.1 | Expected_Break | x \\|\n`)).toEqual([]);
  });

  it('does not take a row of colons for a separator', () => {
    expect(tableErrors(parseExpectations(`${HEAD}| : | : | : |\n`))).toHaveLength(1);
  });

  it('strips bold, underscore and backtick marks from the cells and reads the header in any case', () => {
    expect(ids('| **CRITERION** | Topic | `expectation` |\n|---|---|---|\n| **1.1** | A | __Expected_Break__ |\n| `1.2` | A | `expected hold` |\n'))
      .toEqual([['1.1', 'Expected_Break'], ['1.2', 'Expected_Hold']]);
  });
});

describe('where a table is', () => {
  it('reads a table in a blockquote, nested or not', () => {
    const quote = (prefix: string): string => `${HEAD}| 1.1 | A | Expected_Break |\n`.split('\n').filter((l) => l !== '').map((l) => `${prefix}${l}`).join('\n');
    expect(ids(quote('> '))).toEqual([['1.1', 'Expected_Break']]);
    expect(ids(quote('> > '))).toEqual([['1.1', 'Expected_Break']]);
    expect(ids(quote('>'))).toEqual([['1.1', 'Expected_Break']]);
  });

  it('reads a table without leading or trailing pipes', () => {
    expect(ids('Criterion | Topic | Expectation\n--- | --- | ---\n1.1 | A | Expected_Break\n1.2 | A | Expected_Hold\n')).toEqual([['1.1', 'Expected_Break'], ['1.2', 'Expected_Hold']]);
  });

  it('reads a file whose lines end in a lone CR', () => {
    expect(ids(`${HEAD}| 1.1 | A | Expected_Break |\n`.replace(/\n/g, '\r'))).toEqual([['1.1', 'Expected_Break']]);
  });

  it('reads a file with CRLF, LF and CR line ends mixed', () => {
    expect(ids('| Criterion | Topic | Expectation |\r|---|---|---|\r\n| 1.1 | A | Expected_Break |\n| 1.2 | A | Expected_Hold |\r')).toEqual([['1.1', 'Expected_Break'], ['1.2', 'Expected_Hold']]);
  });

  it('ends a table at the first line without a pipe: rows after it belong to no table', () => {
    const r = parseExpectations(`${HEAD}| 1.1 | A | Expected_Break |\nThe next rows are not part of it.\n| 1.2 | A | Expected_Break |\n`);
    expect([...r.byId]).toEqual([['1.1', 'Expected_Break']]);
    expect(r.issues).toEqual([]);
  });

  it('starts a second table at a header met inside the first, without reading the header as a row', () => {
    const r = parseExpectations(`${HEAD}| 1.1 | A | Expected_Hold |\n| ID | Topic | Expected |\n|---|---|---|\n| 2.1 | A | Expected_Break |\n`);
    expect([...r.byId]).toEqual([['1.1', 'Expected_Hold'], ['2.1', 'Expected_Break']]);
    expect(r.issues).toEqual([]);
    expect(r.tables).toBe(2);
  });

  it('reads a row whose id cell is ID and whose mark starts with Expect as a row when no separator follows', () => {
    const r = parseExpectations(`${HEAD}| ID | A | Expected_Break |\n| 1.1 | A | Expected_Hold |\n`);
    expect([...r.byId]).toEqual([['ID', 'Expected_Break'], ['1.1', 'Expected_Hold']]);
  });
});

describe('the JSON output gives every verdict its expectation (defect 10.3)', () => {
  it('gate --json: verdicts[] carry expectation and met for every line, the default included', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${HEAD}| 1.2 | x | Expected_Break |\n\n### Requirement 1`) });
    await h.run('gate', '--json');
    const j = JSON.parse(h.io.stdoutText());
    expect(j.verdicts.map((v: { reqId: string; expectation: string; met: boolean }) => [v.reqId, v.expectation, v.met])).toEqual([
      ['1.1', 'Expected_Hold', true], ['1.2', 'Expected_Break', true], ['1.3', 'Expected_Hold', true],
    ]);
    expect(j.expectations).toHaveLength(3);
    expect(j.verdicts[0]).toHaveProperty('status');
  });

  it('gate --json without a table: every verdict is Expected_Hold with met', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('gate', '--json');
    expect(JSON.parse(h.io.stdoutText()).verdicts.every((v: { expectation: string; met: boolean }) => v.expectation === 'Expected_Hold' && v.met)).toBe(true);
  });

  it('test --json: every verdict carries expectation and met, with or without a row', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${HEAD}| 1.3 | x | Expected_Break |\n\n### Requirement 1`) });
    await h.run('test', '--json', '--budget', '24');
    const j = JSON.parse(h.io.stdoutText());
    expect(j.verdicts.map((v: { reqId: string; expectation: string; met: boolean }) => [v.reqId, v.expectation, v.met])).toEqual([
      ['1.1', 'Expected_Hold', true], ['1.2', 'Expected_Hold', false], ['1.3', 'Expected_Break', false],
    ]);
  });
});

describe('properties', () => {
  const topic = 'A \\| B';

  it('LF, CRLF or CR, header case and aliases, wrapping, mark case, columns in any order, pipes at the edges or not, a quote prefix and an escaped pipe all give the same marks (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbStyleWide, (rows, style) => {
      const r = parseExpectations(`Some text.${style.eol}${style.eol}${tableText(rows, style, topic)}`);
      expect(r.byId).toEqual(expectedById(rows));
      expect(r.issues).toEqual([]);
    }), { numRuns: 300 });
  });

  it('permuting rows with distinct ids does not change byId (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId).chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }))), arbStyleWide, ([rows, shuffled], style) => {
      const a = parseExpectations(tableText(rows, style)).byId;
      const b = parseExpectations(tableText(shuffled as [string, Mark][], style)).byId;
      expect(b).toEqual(a);
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    }), { numRuns: 200 });
  });

  it('text before and after the table, and a second unrelated table, change nothing (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbStyleWide, (rows, style) => {
      const noise = '| Term | Meaning |\n|---|---|\n| Expected_Break | a mark |\n';
      const text = `${noise}\n${tableText(rows, style)}\nTrailing prose.\n${noise}`;
      expect(parseExpectations(text).byId).toEqual(expectedById(rows));
    }), { numRuns: 100 });
  });
});
