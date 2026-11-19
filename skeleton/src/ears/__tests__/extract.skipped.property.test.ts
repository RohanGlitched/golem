import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractCriteria } from '../extract.js';
import { arbRequirementsFile } from './generators.file.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 34: Extractor skips non-EARS and FOR ALL lines with a warning and ignores bullets
describe('Feature: golem-ears, Property 34: Extractor skips non-EARS and FOR ALL lines with a warning and ignores bullets', () => {
  it('returns only the EARS criteria and one NON_EARS_LINE warning at each other numbered line', () => {
    // **Validates: Requirements 11.5, 11.8, 11.11, 11.12**
    fc.assert(
      fc.property(arbRequirementsFile, (gen) => {
        const { criteria, diagnostics } = extractCriteria(gen.text);

        expect(criteria.map((c) => c.id)).toEqual(gen.criteria.map((c) => c.id));
        expect(criteria.map((c) => c.text)).toEqual(gen.criteria.map((c) => c.text));

        // Bullets and prose never produce a warning or a criterion, so the diagnostics
        // must match the generator's warnings exactly: kind, severity and position.
        const actual = diagnostics.map((d) => ({
          kind: d.kind,
          severity: d.severity,
          line: d.line,
          column: d.column,
          start: d.start,
          end: d.end,
        }));
        const expected = gen.warnings.map((w) => ({
          kind: w.kind,
          severity: w.severity,
          line: w.line,
          column: w.column,
          start: w.start,
          end: w.end,
        }));
        expect(actual).toEqual(expected);
        expect(diagnostics.every((d) => d.message.length > 0)).toBe(true);
      }),
      propConfig,
    );
  });

  it('gives an empty list and no diagnostics for empty input', () => {
    // **Validates: Requirements 11.5, 11.8, 11.11, 11.12**
    expect(extractCriteria('')).toEqual({ criteria: [], diagnostics: [] });
  });

  it('gives an empty list and no diagnostics when there is no Acceptance Criteria heading', () => {
    // **Validates: Requirements 11.5, 11.8, 11.11, 11.12**
    fc.assert(
      fc.property(
        arbRequirementsFile.filter((g) => !/^#### Acceptance Criteria/m.test(g.text)),
        (gen) => {
          expect(extractCriteria(gen.text)).toEqual({ criteria: [], diagnostics: [] });
        },
      ),
      propConfig,
    );
  });
});
