import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractCriteria } from '../extract.js';
import { arbRequirementsFile } from './generators.file.js';
import { propConfig } from './support.js';

describe('extractCriteria properties', () => {
  // Feature: golem-ears, Property 33: Extractor returns qualifying criteria with unique ordered IDs and exact positions
  it('returns the qualifying criteria in file order with unique IDs and exact positions', () => {
    // **Validates: Requirements 11.1, 11.2, 11.4, 11.7, 11.13**
    fc.assert(
      fc.property(arbRequirementsFile, (file) => {
        // The property is stated for files with distinct (n, m) pairs.
        const ids = file.criteria.map((c) => c.id);
        fc.pre(new Set(ids).size === ids.length);

        const { criteria } = extractCriteria(file.text);

        expect(criteria.map((c) => c.id)).toEqual(ids);
        expect(new Set(criteria.map((c) => c.id)).size).toBe(criteria.length);
        for (let i = 0; i < criteria.length; i++) {
          const got = criteria[i]!;
          const want = file.criteria[i]!;
          expect(got.text).toBe(want.text);
          expect(got.line).toBe(want.line);
          expect(got.column).toBe(want.column);
          expect(got.offset).toBe(want.offset);
          // The file text at the reported position starts with the first segment of the text.
          const first = want.segments[0]!;
          expect(file.text.slice(got.offset, got.offset + first.length)).toBe(got.text.slice(0, first.length));
          if (i > 0) expect(got.offset).toBeGreaterThan(criteria[i - 1]!.offset);
        }
      }),
      propConfig,
    );
  });
});
