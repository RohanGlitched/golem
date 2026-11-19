import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildReason } from '../format.js';
import { propConfig } from '../../../test/support/prop.js';

const line = fc.string({ maxLength: 120 }).map((s) => s.replace(/[\r\n]/g, ' '));
const block = fc.array(line, { minLength: 1, maxLength: 12 }).map((l) => l.join('\n'));

describe('Property 20: Kiro reason is bounded and a faithful prefix', () => {
  // Feature: golem-kit, Property 20: Kiro reason is bounded and a faithful prefix
  it('is at most 4000 characters, unchanged when it fits, otherwise a line-boundary prefix plus the report footer', () => {
    fc.assert(fc.property(fc.array(block, { minLength: 1, maxLength: 60 }), fc.constantFrom('.golem/report.json', 'r.json'), (blocks, path) => {
      const joined = blocks.join('\n\n');
      const r = buildReason(blocks, path);
      expect(r.length).toBeLessThanOrEqual(4000);
      if (joined.length <= 4000) { expect(r).toBe(joined); return; }
      const footer = `... truncated, see ${path}`;
      expect(r.endsWith(footer)).toBe(true);
      const prefix = r.slice(0, r.length - footer.length);
      if (prefix !== '') {
        expect(prefix.endsWith('\n')).toBe(true);
        const kept = prefix.slice(0, -1);
        expect(joined.startsWith(kept)).toBe(true);
        expect(joined[kept.length] === '\n' || joined.length === kept.length).toBe(true);
      }
    }), propConfig);
  });

  it('respects a small custom limit', () => {
    fc.assert(fc.property(fc.array(block, { minLength: 1, maxLength: 6 }), fc.integer({ min: 40, max: 300 }), (blocks, max) => {
      expect(buildReason(blocks, 'r.json', max).length).toBeLessThanOrEqual(max);
    }), propConfig);
  });
});
