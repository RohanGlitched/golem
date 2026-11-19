import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbRequirementsFile, buildRequirementsFile } from './generators.file.js';
import type { CriterionKind, FileSpec, ItemSpec } from './generators.file.js';

function crit(
  kind: CriterionKind,
  num: number,
  head: string,
  words: string,
  over: Partial<Extract<ItemSpec, { k: 'criterion' }>> = {},
): ItemSpec {
  return { k: 'criterion', kind, num, indent: '', sep: '.', gap: ' ', head, words, trail: '', conts: [], ...over };
}

// Hand-written file with its expected positions worked out by counting characters.
const HAND = [
  '# Requirements', //                                         line 1, offset 0
  '### Requirement 1: Push', //                                 line 2, offset 15
  '#### Acceptance Criteria', //                                line 3, offset 38
  '1. WHEN a b', //                                             line 4, offset 63
  '2) THE robot SHALL', //                                      line 5, offset 75
  '   stay up', //                                              line 6, offset 94
  '- bullet', //                                                line 7, offset 105
  '3. FOR ALL x', //                                            line 8, offset 114
  '4. A pelvis', //                                             line 9, offset 127
  '',
].join('\n');

const HAND_SPEC: FileSpec = {
  eol: '\n',
  finalEol: true,
  preamble: ['# Requirements'],
  sections: [
    {
      r0: false,
      reqNumber: 1,
      title: 'Push',
      prose: [],
      pre: [],
      blocks: [
        {
          heading: 'ac',
          headingTrail: '',
          items: [
            crit('ears', 1, 'WHEN', 'a b'),
            crit('ears', 2, 'THE', 'robot SHALL', {
              sep: ')',
              conts: [{ indent: '   ', text: 'stay up', trail: '' }],
            }),
            { k: 'bullet', mark: '-', text: 'bullet' },
            crit('for-all', 3, 'FOR ALL', 'x'),
            crit('non-ears', 4, 'A', 'pelvis'),
          ],
        },
      ],
      closeWithH2: false,
    },
  ],
};

describe('buildRequirementsFile', () => {
  it('renders the hand-written file text', () => {
    expect(buildRequirementsFile(HAND_SPEC).text).toBe(HAND);
  });

  it('expects the ids, texts, lines, columns and offsets of the hand-written file', () => {
    const { criteria } = buildRequirementsFile(HAND_SPEC);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toMatchObject({ id: '1.1', text: 'WHEN a b', line: 4, column: 4, offset: HAND.indexOf('WHEN') });
    expect(criteria[1]).toMatchObject({
      id: '1.2',
      text: 'THE robot SHALL stay up',
      line: 5,
      column: 4,
      offset: HAND.indexOf('THE robot'),
    });
    const seg = criteria[1]!.segments[1]!;
    expect(seg).toMatchObject({ textIndex: 16, length: 7, line: 6, column: 4, offset: HAND.indexOf('stay up') });
  });

  it('expects one warning each for the FOR ALL and the non-EARS line', () => {
    const { warnings } = buildRequirementsFile(HAND_SPEC);
    expect(warnings).toEqual([
      {
        kind: 'NON_EARS_LINE', severity: 'warning', reason: 'for-all',
        line: 8, column: 4, start: HAND.indexOf('FOR ALL'), end: HAND.indexOf('FOR ALL') + 'FOR ALL x'.length,
      },
      {
        kind: 'NON_EARS_LINE', severity: 'warning', reason: 'non-ears',
        line: 9, column: 4, start: HAND.indexOf('A pelvis'), end: HAND.indexOf('A pelvis') + 'A pelvis'.length,
      },
    ]);
  });

  it('numbers criteria before any requirement heading as R0 with a whole-line warning first', () => {
    const f = buildRequirementsFile({
      eol: '\r\n',
      finalEol: false,
      preamble: [],
      sections: [
        {
          r0: true, reqNumber: 1, title: undefined, prose: [], pre: [], closeWithH2: false,
          blocks: [{ heading: 'ac', headingTrail: '', items: [crit('ears', 1, 'THE', 'robot SHALL stand')] }],
        },
      ],
    });
    expect(f.text).toBe('#### Acceptance Criteria\r\n1. THE robot SHALL stand');
    expect(f.criteria.map((c) => [c.id, c.line, c.column, c.offset])).toEqual([['R0.1', 2, 4, 29]]);
    expect(f.warnings).toEqual([
      { kind: 'NON_EARS_LINE', severity: 'warning', reason: 'r0', line: 2, column: 1, start: 26, end: 50 },
    ]);
  });

  it('ignores items under a heading other than Acceptance Criteria', () => {
    const f = buildRequirementsFile({
      ...HAND_SPEC,
      sections: [{ ...HAND_SPEC.sections[0]!, blocks: [{ heading: 'other', headingTrail: '', items: [crit('ears', 1, 'THE', 'robot SHALL x')] }] }],
    });
    expect(f.criteria).toEqual([]);
    expect(f.warnings).toEqual([]);
  });
});

describe('arbRequirementsFile', () => {
  it('generates files whose expected offsets point at the expected text', () => {
    fc.assert(
      fc.property(arbRequirementsFile, (f) => {
        for (const c of f.criteria) {
          for (const s of c.segments) {
            expect(f.text.slice(s.offset, s.offset + s.length)).toBe(c.text.slice(s.textIndex, s.textIndex + s.length));
          }
        }
        const starts = f.warnings.map((w) => w.start);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      }),
      { numRuns: 100 },
    );
  });

  it('generates both line endings and both numbering separators', () => {
    const files = fc.sample(arbRequirementsFile, 200);
    expect(new Set(files.map((f) => f.spec.eol)).size).toBe(2);
    expect(files.some((f) => /^[ \t]*\d+\)/m.test(f.text))).toBe(true);
    expect(files.some((f) => f.warnings.some((w) => w.reason === 'for-all'))).toBe(true);
    expect(files.some((f) => f.criteria.some((c) => c.segments.length > 1))).toBe(true);
  });
});
