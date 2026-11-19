import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractCriteria, type RawCriterion } from '../extract.js';
import { arbRequirementsFile, buildRequirementsFile, type FileSpec, type ItemSpec } from './generators.file.js';
import { propConfig } from './support.js';

/**
 * Feature: golem-ears, Property 35: Extractor is insensitive to line endings, number format and continuation layout
 *
 * **Validates: Requirements 11.8, 11.9, 11.10**
 *
 * Offsets legitimately change with the line ending (each CRLF adds one character per preceding
 * line), so for the LF/CRLF comparison offsets are compared after that documented adjustment.
 * IDs, texts, lines and columns are compared as they are.
 */

const toLf = (s: string): string => s.replace(/\r\n/g, '\n');
const toCrlf = (s: string): string => toLf(s).replace(/\n/g, '\r\n');

const idText = (cs: readonly RawCriterion[]): { id: string; text: string }[] => cs.map((c) => ({ id: c.id, text: c.text }));

type Criterion = Extract<ItemSpec, { k: 'criterion' }>;

function mapItems(spec: FileSpec, f: (it: ItemSpec) => ItemSpec): FileSpec {
  return {
    ...spec,
    sections: spec.sections.map((s) => ({
      ...s,
      pre: s.pre.map(f),
      blocks: s.blocks.map((b) => ({ ...b, items: b.items.map(f) })),
    })),
  };
}

const INDENTS = [' ', '   ', '\t', '    '] as const;
const arbRecipe = fc.array(
  fc.record({ size: fc.integer({ min: 1, max: 4 }), indent: fc.constantFrom(...INDENTS) }),
  { minLength: 1, maxLength: 12 },
);

/** Re-splits the words of an EARS criterion into a new first line and continuation lines. */
function rewrap(spec: FileSpec, recipe: readonly { size: number; indent: string }[]): FileSpec {
  let n = 0;
  return mapItems(spec, (it) => {
    if (it.k !== 'criterion' || it.kind !== 'ears') return it;
    const words = [it.head, ...(it.words === '' ? [] : it.words.split(' ')), ...it.conts.flatMap((c) => c.text.split(' '))];
    const take = (): { size: number; indent: string } => recipe[n++ % recipe.length]!;
    const first = take().size;
    const firstWords = words.slice(0, first);
    const conts: Criterion['conts'] = [];
    for (let i = first; i < words.length; ) {
      const r = take();
      conts.push({ indent: r.indent, text: words.slice(i, i + r.size).join(' '), trail: '' });
      i += r.size;
    }
    return { ...it, head: firstWords[0]!, words: firstWords.slice(1).join(' '), conts };
  });
}

describe('Property 35: layout insensitivity', () => {
  it('returns the same ids, texts, lines and columns for LF and CRLF, with offsets shifted per line', () => {
    fc.assert(
      fc.property(arbRequirementsFile, (g) => {
        const lf = extractCriteria(toLf(g.text));
        const crlf = extractCriteria(toCrlf(g.text));
        expect(crlf.criteria.length).toBe(lf.criteria.length);
        lf.criteria.forEach((a, i) => {
          const b = crlf.criteria[i]!;
          expect([b.id, b.text, b.line, b.column]).toEqual([a.id, a.text, a.line, a.column]);
          expect(b.offset).toBe(a.offset + (a.line - 1));
          expect(b.segments.length).toBe(a.segments.length);
          a.segments.forEach((s, j) => {
            const t = b.segments[j]!;
            expect([t.textIndex, t.length, t.line, t.column]).toEqual([s.textIndex, s.length, s.line, s.column]);
            expect(t.offset).toBe(s.offset + (s.line - 1));
          });
        });
        expect(crlf.diagnostics.map((d) => [d.line, d.column])).toEqual(lf.diagnostics.map((d) => [d.line, d.column]));
      }),
      propConfig,
    );
  });

  it('returns the same ids and texts whether numbers are written "<m>." or "<m>)"', () => {
    fc.assert(
      fc.property(arbRequirementsFile, fc.constantFrom('.' as const, ')' as const), (g, sep) => {
        const flipped = buildRequirementsFile(mapItems(g.spec, (it) => (it.k === 'criterion' ? { ...it, sep } : it)));
        const got = extractCriteria(flipped.text);
        expect(idText(got.criteria)).toEqual(idText(g.criteria));
        expect(got.criteria.map((c) => [c.line, c.column])).toEqual(g.criteria.map((c) => [c.line, c.column]));
      }),
      propConfig,
    );
  });

  it('joins re-wrapped continuation lines with single spaces to the same text', () => {
    fc.assert(
      fc.property(arbRequirementsFile, arbRecipe, (g, recipe) => {
        const wrapped = buildRequirementsFile(rewrap(g.spec, recipe));
        const got = extractCriteria(wrapped.text);
        expect(idText(got.criteria)).toEqual(idText(g.criteria));
        expect(got.criteria).toEqual(wrapped.criteria);
      }),
      propConfig,
    );
  });
});
