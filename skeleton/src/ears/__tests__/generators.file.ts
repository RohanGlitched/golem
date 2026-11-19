import fc from 'fast-check';

/**
 * Requirements-file generator for `extractCriteria`.
 *
 * `buildRequirementsFile` renders a structural spec to text and, in the same pass, computes the
 * expected criteria and warnings from the layout it writes. It does not read extract.ts or use
 * its regexes; positions come from counting the characters that are emitted.
 */

export type CriterionKind = 'ears' | 'non-ears' | 'for-all';

export interface ContSpec { indent: string; text: string; trail: string }

export type ItemSpec =
  | {
      k: 'criterion';
      kind: CriterionKind;
      num: number;
      /** Whitespace before the number. */
      indent: string;
      sep: '.' | ')';
      /** Whitespace between the separator and the text. */
      gap: string;
      /** First words of the body: keyword for EARS, a non-keyword for non-EARS, "FOR ALL" variant. */
      head: string;
      words: string;
      trail: string;
      conts: ContSpec[];
    }
  | { k: 'blank'; ws: string }
  | { k: 'bullet'; mark: '-' | '*' | '+'; text: string }
  | { k: 'prose'; text: string }
  /** An indented line after a blank line; nothing to continue, so it is ignored. */
  | { k: 'orphan'; ws: string; text: string };

export interface BlockSpec {
  /** 'ac' = "#### Acceptance Criteria"; 'other' = a different heading, whose items are ignored. */
  heading: 'ac' | 'other';
  headingTrail: string;
  items: ItemSpec[];
}

export interface SectionSpec {
  /** No "### Requirement" heading: criteria are numbered R0. Only valid for the first section. */
  r0: boolean;
  reqNumber: number;
  title: string | undefined;
  prose: string[];
  /** Numbered lines before any acceptance heading; ignored. */
  pre: ItemSpec[];
  blocks: BlockSpec[];
  /** A "## Next" heading after the section. */
  closeWithH2: boolean;
}

export interface FileSpec {
  eol: '\n' | '\r\n';
  finalEol: boolean;
  preamble: string[];
  sections: SectionSpec[];
}

export interface ExpectedSegment {
  textIndex: number;
  length: number;
  offset: number;
  line: number;
  column: number;
}

export interface ExpectedCriterion {
  id: string;
  text: string;
  line: number;
  column: number;
  offset: number;
  segments: ExpectedSegment[];
}

export interface ExpectedWarning {
  kind: 'NON_EARS_LINE';
  severity: 'warning';
  line: number;
  column: number;
  start: number;
  end: number;
  reason: 'r0' | 'non-ears' | 'for-all';
}

export interface GeneratedFile {
  spec: FileSpec;
  text: string;
  criteria: ExpectedCriterion[];
  /** Ascending by start; for equal starts, the R0 warning comes first. */
  warnings: ExpectedWarning[];
}

function bodyOf(it: Extract<ItemSpec, { k: 'criterion' }>): string {
  return it.words === '' ? it.head : `${it.head} ${it.words}`;
}

export function buildRequirementsFile(spec: FileSpec): GeneratedFile {
  const eol = spec.eol;
  const lines: string[] = [];
  let off = 0;
  const emit = (s: string): { start: number; line: number } => {
    const r = { start: off, line: lines.length + 1 };
    lines.push(s);
    off += s.length + eol.length;
    return r;
  };

  const criteria: ExpectedCriterion[] = [];
  const warnings: ExpectedWarning[] = [];

  const emitItems = (items: readonly ItemSpec[], collect: boolean, r0: boolean, req: number): void => {
    for (const it of items) {
      if (it.k === 'blank') emit(it.ws);
      else if (it.k === 'bullet') emit(`${it.mark} ${it.text}`);
      else if (it.k === 'prose') emit(it.text);
      else if (it.k === 'orphan') {
        emit('');
        emit(`${it.ws}${it.text}`);
      } else {
        const body = bodyOf(it);
        const numText = `${it.indent}${it.num}${it.sep}${it.gap}`;
        const { start, line } = emit(`${numText}${body}${it.trail}`);
        const lineLen = numText.length + body.length + it.trail.length;
        const column = numText.length + 1;
        const offset = start + numText.length;
        let text = body;
        const segments: ExpectedSegment[] = [{ textIndex: 0, length: body.length, offset, line, column }];
        for (const c of it.conts) {
          const cl = emit(`${c.indent}${c.text}${c.trail}`);
          segments.push({
            textIndex: text.length + 1,
            length: c.text.length,
            offset: cl.start + c.indent.length,
            line: cl.line,
            column: c.indent.length + 1,
          });
          text = `${text} ${c.text}`;
        }
        if (!collect) continue;
        const id = `${r0 ? 'R0' : String(req)}.${it.num}`;
        if (r0) {
          warnings.push({ kind: 'NON_EARS_LINE', severity: 'warning', line, column: 1, start, end: start + lineLen, reason: 'r0' });
        }
        if (it.kind === 'ears') {
          criteria.push({ id, text, line, column, offset, segments });
        } else {
          warnings.push({
            kind: 'NON_EARS_LINE',
            severity: 'warning',
            line,
            column,
            start: offset,
            end: offset + body.length,
            reason: it.kind === 'for-all' ? 'for-all' : 'non-ears',
          });
        }
      }
    }
  };

  for (const p of spec.preamble) emit(p);
  for (const sec of spec.sections) {
    if (!sec.r0) {
      emit(sec.title === undefined ? `### Requirement ${sec.reqNumber}` : `### Requirement ${sec.reqNumber}: ${sec.title}`);
    }
    for (const p of sec.prose) emit(p);
    emitItems(sec.pre, false, sec.r0, sec.reqNumber);
    for (const b of sec.blocks) {
      emit(b.heading === 'ac' ? `#### Acceptance Criteria${b.headingTrail}` : `#### Notes${b.headingTrail}`);
      emitItems(b.items, b.heading === 'ac', sec.r0, sec.reqNumber);
    }
    if (sec.closeWithH2) emit('## Next');
  }

  // Stable sort by start; emission order puts the R0 warning before the non-EARS one on a line.
  const sorted = warnings
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.start - b.w.start || a.i - b.i)
    .map((e) => e.w);

  return {
    spec,
    text: lines.join(eol) + (spec.finalEol ? eol : ''),
    criteria,
    warnings: sorted,
  };
}

// ---------- arbitraries ----------

const letters = [...'abcdefghijklmnopqrstuvwxyz'];
const arbLetterWord = fc.array(fc.constantFrom(...letters), { minLength: 1, maxLength: 8 }).map((a) => a.join(''));
const arbTokenWord = fc.oneof(
  { arbitrary: arbLetterWord, weight: 4 },
  { arbitrary: arbLetterWord.map((w) => `${w},`), weight: 1 },
  { arbitrary: fc.constantFrom('200', '0.2', '3', 'N', 'm/s', '0.10'), weight: 2 },
);
/** Words for a body; the first word is a letter word so a continuation never looks like a number. */
const arbWords = (min: number): fc.Arbitrary<string> =>
  fc
    .tuple(arbLetterWord, fc.array(arbTokenWord, { minLength: Math.max(0, min - 1), maxLength: 5 }))
    .map(([a, rest]) => [a, ...rest].join(' '));

const arbTrail = fc.constantFrom('', '', '', ' ', '\t', '  ');
const arbEarsHead = fc.constantFrom('WHEN', 'WHILE', 'IF', 'WHERE', 'THE', 'when', 'while', 'where', 'the', 'When', 'The');
const arbNonEarsHead = fc.constantFrom('A', 'Robots', 'Then', 'Whenever', 'Theory', 'Where_', 'Ifs', 'Stay');
const arbForAllHead = fc.constantFrom('FOR ALL', 'for all', 'For ALL', 'FOR\tALL', 'FOR  ALL');

const arbCont: fc.Arbitrary<ContSpec> = fc.record({
  indent: fc.constantFrom(' ', '   ', '\t', '    '),
  text: arbWords(1),
  trail: arbTrail,
});

const arbCriterion = (kind: CriterionKind): fc.Arbitrary<ItemSpec> =>
  fc.record({
    k: fc.constant('criterion' as const),
    kind: fc.constant(kind),
    num: fc.integer({ min: 1, max: 30 }),
    indent: fc.constantFrom('', '', '', ' ', '  ', '\t'),
    sep: fc.constantFrom('.' as const, ')' as const),
    gap: fc.constantFrom(' ', ' ', '  ', '\t'),
    head: kind === 'ears' ? arbEarsHead : kind === 'for-all' ? arbForAllHead : arbNonEarsHead,
    words: kind === 'ears' ? arbWords(2) : arbWords(1),
    trail: arbTrail,
    conts: fc.array(arbCont, { minLength: 0, maxLength: 2 }),
  });

const arbItem: fc.Arbitrary<ItemSpec> = fc.oneof(
  { arbitrary: arbCriterion('ears'), weight: 6 },
  { arbitrary: arbCriterion('non-ears'), weight: 2 },
  { arbitrary: arbCriterion('for-all'), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('blank' as const), ws: fc.constantFrom('', '', ' ', '\t') }), weight: 2 },
  {
    arbitrary: fc.record({
      k: fc.constant('bullet' as const),
      mark: fc.constantFrom('-' as const, '*' as const, '+' as const),
      text: arbWords(1),
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ k: fc.constant('prose' as const), text: arbWords(2) }), weight: 1 },
  {
    arbitrary: fc.record({ k: fc.constant('orphan' as const), ws: fc.constantFrom(' ', '   ', '\t'), text: arbWords(1) }),
    weight: 1,
  },
);

const arbBlock: fc.Arbitrary<BlockSpec> = fc.record({
  heading: fc.constantFrom('ac' as const, 'ac' as const, 'ac' as const, 'other' as const),
  headingTrail: fc.constantFrom('', '', ' ', '\t'),
  items: fc.array(arbItem, { minLength: 0, maxLength: 8 }),
});

const arbSection = (r0: boolean): fc.Arbitrary<SectionSpec> =>
  fc.record({
    r0: fc.constant(r0),
    reqNumber: fc.integer({ min: 1, max: 20 }),
    title: fc.option(arbWords(1), { nil: undefined }),
    prose: fc.array(arbWords(2).map((w) => `**User Story:** ${w}`), { minLength: 0, maxLength: 2 }),
    pre: fc.array(arbCriterion('ears'), { minLength: 0, maxLength: 1 }),
    blocks: fc.array(arbBlock, { minLength: 1, maxLength: 2 }),
    closeWithH2: fc.boolean(),
  });

const arbPreamble: fc.Arbitrary<string[]> = fc.array(
  fc.oneof(
    fc.constant('# Requirements'),
    fc.constant('## Introduction'),
    fc.constant(''),
    arbWords(2).map((w) => `Intro ${w}`),
  ),
  { minLength: 0, maxLength: 4 },
);

export const arbFileSpec: fc.Arbitrary<FileSpec> = fc.record({
  eol: fc.constantFrom('\n' as const, '\r\n' as const),
  finalEol: fc.boolean(),
  preamble: arbPreamble,
  sections: fc
    .tuple(fc.boolean(), fc.array(arbSection(false), { minLength: 0, maxLength: 3 }))
    .chain(([withR0, rest]) =>
      withR0 ? arbSection(true).map((first) => [first, ...rest]) : fc.constant(rest),
    ),
});

/** A requirements.md-shaped text with the criteria and warnings an extractor must report. */
export const arbRequirementsFile: fc.Arbitrary<GeneratedFile> = arbFileSpec.map(buildRequirementsFile);
