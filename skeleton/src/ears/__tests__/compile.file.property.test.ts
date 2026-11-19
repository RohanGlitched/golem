import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement, compileRequirementsFile } from '../compile.js';
import type { Diagnostic } from '../diagnostics.js';
import type { Lexicon } from '../types.js';
import { arbLexicon, arbMutation, arbValidLine } from './generators.js';
import { refLineColumn } from './refTokenize.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 36: File compilation isolates failures and reports in file coordinates
// **Validates: Requirements 12.8, 12.9, 12.10, 8.14**

const CONT_INDENT = '    ';

interface Crit {
  id: string;
  /** Criterion text as the extractor joins it (continuation lines joined by one space). */
  body: string;
  /** True when the generator made a line that must compile. */
  mustCompile: boolean;
  /** File offset of body[0]. */
  bodyOffset: number;
  /** Index in body of the space replaced by a line break, or -1. */
  wrapAt: number;
  /** File offset of the first character after the line break and indent. */
  contOffset: number;
  /** Line break text used. */
  eol: string;
}

interface Built { text: string; crits: Crit[] }

interface CritSpec { body: string; mustCompile: boolean; wrapPick: number | undefined; number: number }
interface FileSpec { sections: CritSpec[][]; eol: '\n' | '\r\n' }

function buildFile(spec: FileSpec): Built {
  let text = '';
  const crits: Crit[] = [];
  const nl = spec.eol;
  spec.sections.forEach((section, si) => {
    text += `### Requirement ${si + 1}${nl}${nl}#### Acceptance Criteria${nl}${nl}`;
    for (const c of section) {
      text += `${c.number}. `;
      const bodyOffset = text.length;
      const spaces: number[] = [];
      for (let i = 0; i < c.body.length; i++) if (c.body[i] === ' ') spaces.push(i);
      let wrapAt = -1;
      let contOffset = -1;
      if (c.wrapPick !== undefined && spaces.length > 0) {
        wrapAt = spaces[c.wrapPick % spaces.length]!;
        text += c.body.slice(0, wrapAt) + nl + CONT_INDENT;
        contOffset = text.length;
        text += c.body.slice(wrapAt + 1);
      } else {
        text += c.body;
      }
      text += nl;
      crits.push({
        id: `${si + 1}.${c.number}`, body: c.body, mustCompile: c.mustCompile,
        bodyOffset, wrapAt, contOffset, eol: nl,
      });
    }
  });
  return { text, crits };
}

/** File offset of the character at `index` of the criterion's joined text. */
function fileOffset(c: Crit, index: number): number {
  if (c.wrapAt < 0 || index < c.wrapAt) return c.bodyOffset + index;
  if (index === c.wrapAt) return c.bodyOffset + c.wrapAt; // the joining space clamps to the end of the first piece
  return c.contOffset + (index - c.wrapAt - 1);
}

const arbCritSpec = (lexicon: Lexicon): fc.Arbitrary<Omit<CritSpec, 'number'>> =>
  fc
    .tuple(
      arbValidLine(lexicon),
      fc.boolean(),
      fc.nat(1000),
      fc.option(fc.nat(1000), { nil: undefined }),
    )
    .chain(([line, invalid, , wrapPick]) => {
      const idLen = line.idText !== undefined ? line.idText.length + 1 : 0;
      const head = line.text.slice(idLen, line.spans.response.start);
      const valid = line.text.slice(idLen);
      return arbMutation(line.response.text).map((m) => {
        const useMutation = invalid && m.changed;
        const body = (useMutation ? head + m.text : valid).trimEnd();
        return { body, mustCompile: !useMutation, wrapPick };
      });
    });

const arbFileSpec: fc.Arbitrary<{ lexicon: Lexicon; spec: FileSpec }> = arbLexicon.chain((lexicon) =>
  fc
    .tuple(
      fc.array(fc.array(arbCritSpec(lexicon), { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }),
      fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n'),
    )
    .map(([sections, eol]) => ({
      lexicon,
      spec: { sections: sections.map((s) => s.map((c, i) => ({ ...c, number: i + 1 }))), eol },
    })),
);

const sameText = (s: string): string => s.replace(/\s+/g, ' ');

describe('Property 36: compileRequirementsFile isolates failures and reports in file coordinates', () => {
  it('compiles every valid criterion in file order whatever its invalid neighbours are', () => {
    let withInvalid = 0;
    fc.assert(
      fc.property(arbFileSpec, ({ lexicon, spec }) => {
        const { text, crits } = buildFile(spec);
        const result = compileRequirementsFile(text, lexicon);
        const expectedIds: string[] = [];
        for (const c of crits) {
          const alone = compileRequirement(c.body, lexicon, { id: c.id });
          if (c.mustCompile) expect(alone.requirement, c.body).toBeDefined();
          else withInvalid++;
          if (alone.requirement) expectedIds.push(c.id);
        }
        expect(result.requirements.map((r) => r.id)).toEqual(expectedIds);
        const byId = new Map(crits.map((c) => [c.id, c]));
        for (const r of result.requirements) {
          expect(r.source).toBe(byId.get(r.id)!.body);
        }
        for (const c of crits) if (c.mustCompile) expect(expectedIds).toContain(c.id);
      }),
      propConfig,
    );
    expect(withInvalid).toBeGreaterThan(0);
  });

  it('reports each diagnostic at the file coordinates of the same offending text as the standalone compile', () => {
    let checked = 0;
    fc.assert(
      fc.property(arbFileSpec, ({ lexicon, spec }) => {
        const { text, crits } = buildFile(spec);
        const result = compileRequirementsFile(text, lexicon);
        const expected: Diagnostic[] = [];
        for (const c of crits) {
          const alone = compileRequirement(c.body, lexicon, { id: c.id });
          for (const d of alone.diagnostics) {
            const start = fileOffset(c, d.start);
            const end = d.end > d.start ? fileOffset(c, d.end - 1) + 1 : start;
            const pos = refLineColumn(text, start);
            expected.push({ ...d, start, end, line: pos.line, column: pos.column });
          }
        }
        const got = result.diagnostics.filter((d) => !(d.kind === 'NON_EARS_LINE' && d.severity === 'warning'));
        expect(got).toEqual(expected);
        for (const d of got) {
          const pos = refLineColumn(text, d.start);
          expect(d.line).toBe(pos.line);
          expect(d.column).toBe(pos.column);
          expect(d.end).toBeGreaterThanOrEqual(d.start);
          checked++;
        }
        // Same offending text as in the standalone compile (joins read as one space).
        for (const c of crits) {
          const alone = compileRequirement(c.body, lexicon, { id: c.id });
          for (const d of alone.diagnostics) {
            const start = fileOffset(c, d.start);
            const end = d.end > d.start ? fileOffset(c, d.end - 1) + 1 : start;
            expect(sameText(text.slice(start, end))).toBe(sameText(c.body.slice(d.start, d.end)));
          }
        }
      }),
      propConfig,
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('adds one warning at the second criterion for a repeated id and keeps both requirements', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lexicon) =>
          fc.tuple(
            fc.constant(lexicon),
            arbValidLine(lexicon),
            arbValidLine(lexicon),
            fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n'),
          ),
        ),
        ([lexicon, a, b, nl]) => {
          const strip = (l: { text: string; idText?: string }): string =>
            l.text.slice(l.idText !== undefined ? l.idText.length + 1 : 0);
          const bodyA = strip(a);
          const bodyB = strip(b);
          const head = `### Requirement 4${nl}${nl}#### Acceptance Criteria${nl}${nl}`;
          const first = `2. ${bodyA}${nl}${nl}`;
          const text = `${head}${first}2. ${bodyB}${nl}`;
          const secondOffset = head.length + first.length + 3;
          const r = compileRequirementsFile(text, lexicon);
          const warns = r.diagnostics.filter((d) => d.severity === 'warning');
          expect(warns).toHaveLength(1);
          const w = warns[0]!;
          const pos = refLineColumn(text, secondOffset);
          expect(w.start).toBe(secondOffset);
          expect(w.line).toBe(pos.line);
          expect(w.column).toBe(pos.column);
          expect(w.message).toContain('4.2');
          expect(r.requirements.map((q) => q.id)).toEqual(['4.2', '4.2']);
        },
      ),
      propConfig,
    );
  });
});
