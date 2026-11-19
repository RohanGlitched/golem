import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatEntry, parseEntries } from '../proposals.js';
import { propConfig } from '../../../test/support/prop.js';

const single = fc.string({ minLength: 1, maxLength: 80 }).map((s) => s.replace(/[\r\n]+/g, ' '));
const stamp = fc.integer({ min: 0, max: 4102444800000 }).map((t) => new Date(t).toISOString());

describe('Property 37: proposal entry round trip', () => {
  // Feature: golem-kit, Property 37: Proposal entry round trip
  it('parses back what it formats, alone or after other entries', () => {
    fc.assert(fc.property(fc.array(fc.record({ timestamp: stamp, text: single, rationale: fc.option(single, { nil: undefined }) }, { requiredKeys: ['timestamp', 'text'] }), { minLength: 1, maxLength: 5 }), (es) => {
      const file = `# Proposed\n\n${es.map((e) => formatEntry(e.rationale === undefined ? { timestamp: e.timestamp, text: e.text } : e)).join('\n')}`;
      const back = parseEntries(file).entries.map(({ line: _l, ...e }) => e);
      expect(back).toEqual(es.map((e) => (e.rationale === undefined ? { timestamp: e.timestamp, text: e.text } : e)));
    }), propConfig);
  });
});
