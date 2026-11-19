// Generators for Expectation tables: ids from a small alphabet (so collisions and orphans happen), marks, and the
// spelling variants a reader of Markdown must accept (line ends, header case, bold, backticks, column order, extra columns).
import fc from 'fast-check';

export type Mark = 'Expected_Hold' | 'Expected_Break';

/** Ids of the Tiny requirements, plus ids that no criterion has. */
export const TINY_IDS = ['1.1', '1.2', '1.3'] as const;
export const arbMark: fc.Arbitrary<Mark> = fc.constantFrom('Expected_Hold' as const, 'Expected_Break' as const);
export const arbKnownId: fc.Arbitrary<string> = fc.constantFrom(...TINY_IDS);
export const arbUnknownId: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.integer({ min: 2, max: 9 }), fc.integer({ min: 1, max: 9 })).map(([a, b]) => `${a}.${b}`),
  fc.constantFrom('R1.2', '1.20', '1.2.', 'Req 1.3', '1.4 and 1.5', '11.1', '1.9'),
);
/** Distinct ids with a mark each. */
export const arbRows = (ids: fc.Arbitrary<string>, max = 6): fc.Arbitrary<[string, Mark][]> =>
  fc.uniqueArray(fc.tuple(ids, arbMark), { selector: (r) => r[0], maxLength: max });

export interface TableStyle {
  eol: '\n' | '\r\n' | '\r';
  /** Header spelling for the id column and the expectation column. */
  idHeader: string;
  expHeader: string;
  /** Wrap each cell of the id and mark columns. */
  wrap: '' | '**' | '`';
  /** Case of the mark text. */
  markCase: 'canonical' | 'upper' | 'lower' | 'spaced';
  /** Put the expectation column before the id column. */
  swap: boolean;
  extraColumn: boolean;
  leadingPipes: boolean;
  /** Prefix of every table line, such as `> `. */
  prefix: '' | '> ' | '> > ';
}

export const CANONICAL: TableStyle = {
  eol: '\n', idHeader: 'Criterion', expHeader: 'Expectation', wrap: '', markCase: 'canonical', swap: false, extraColumn: true, leadingPipes: true, prefix: '',
};

const markText = (m: Mark, c: TableStyle['markCase']): string => {
  switch (c) {
    case 'canonical': return m;
    case 'upper': return m.toUpperCase();
    case 'lower': return m.toLowerCase();
    case 'spaced': return m.replace('_', ' ').toLowerCase();
  }
};

/** Spellings every version of the parser accepts: LF or CRLF, header case, wrapping, mark case, column order. */
export const arbStyle: fc.Arbitrary<TableStyle> = fc.record({
  eol: fc.constantFrom('\n' as const, '\r\n' as const),
  idHeader: fc.constantFrom('Criterion', 'criterion', 'CRITERION'),
  expHeader: fc.constantFrom('Expectation', 'expectation', 'EXPECTATION'),
  wrap: fc.constantFrom('' as const, '**' as const, '`' as const),
  markCase: fc.constantFrom('canonical' as const, 'upper' as const, 'lower' as const, 'spaced' as const),
  swap: fc.boolean(),
  extraColumn: fc.boolean(),
  leadingPipes: fc.constant(true),
  prefix: fc.constant('' as const),
});

/** Every spelling the parser accepts, among them a lone CR, the header aliases, pipe-less rows and a blockquote. */
export const arbStyleWide: fc.Arbitrary<TableStyle> = fc.record({
  eol: fc.constantFrom('\n' as const, '\r\n' as const, '\r' as const),
  idHeader: fc.constantFrom('Criterion', 'criterion', 'CRITERION', 'Criteria', 'ID', 'id', '#'),
  expHeader: fc.constantFrom('Expectation', 'expectation', 'EXPECTATION', 'Expectations', 'Expected'),
  wrap: fc.constantFrom('' as const, '**' as const, '`' as const),
  markCase: fc.constantFrom('canonical' as const, 'upper' as const, 'lower' as const, 'spaced' as const),
  swap: fc.boolean(),
  extraColumn: fc.boolean(),
  leadingPipes: fc.boolean(),
  prefix: fc.constantFrom('' as const, '> ' as const, '> > ' as const),
});

/** The lines of a table (no trailing blank line). `topic` is the content of the extra column. */
export function tableLines(rows: readonly (readonly [string, Mark])[], s: TableStyle = CANONICAL, topic = 'Topic'): string[] {
  const w = (t: string): string => `${s.wrap}${t}${s.wrap}`;
  const line = (cells: string[]): string => `${s.prefix}${s.leadingPipes ? `| ${cells.join(' | ')} |` : cells.join(' | ')}`;
  const order = (id: string, exp: string, extra: string): string[] => {
    const c = s.swap ? [exp, id] : [id, exp];
    return s.extraColumn ? [c[0] as string, extra, c[1] as string] : c;
  };
  const sep = order('---', '---', '---');
  return [
    line(order(s.idHeader, s.expHeader, 'Topic')),
    line(sep),
    ...rows.map(([id, m]) => line(order(w(id), w(markText(m, s.markCase)), topic))),
  ];
}

/** A whole table as text with the style's line ends and a final line end. */
export const tableText = (rows: readonly (readonly [string, Mark])[], s: TableStyle = CANONICAL, topic = 'Topic'): string =>
  `${tableLines(rows, s, topic).join(s.eol)}${s.eol}`;

/** The expected `byId` of rows that have distinct ids. */
export const expectedById = (rows: readonly (readonly [string, Mark])[]): Map<string, Mark> => new Map(rows);
