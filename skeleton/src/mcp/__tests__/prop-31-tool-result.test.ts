import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeToolResult } from '../result.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 31: Tool_Result has one summary line and valid JSON', () => {
  // Feature: golem-kit, Property 31: Tool_Result has one summary line and valid JSON
  it('has exactly two blocks, a non-empty one-line summary of at most 200 characters, and parseable JSON', () => {
    fc.assert(fc.property(
      fc.oneof(fc.string(), fc.string({ minLength: 300, maxLength: 600 }), fc.constantFrom('a\nb', '\n\n', '', '   ', 'x\r\ny')),
      fc.jsonValue(), fc.boolean(),
      (summary, json, isError) => {
        const r = makeToolResult(summary, json, isError);
        expect(r.content).toHaveLength(2);
        const [s, j] = r.content;
        expect(s.type).toBe('text');
        expect(s.text.length).toBeGreaterThan(0);
        expect(s.text.length).toBeLessThanOrEqual(200);
        expect(/[\r\n]/.test(s.text)).toBe(false);
        expect(() => JSON.parse(j.text)).not.toThrow();
        expect(r.isError === true).toBe(isError);
      },
    ), propConfig);
  });
});
