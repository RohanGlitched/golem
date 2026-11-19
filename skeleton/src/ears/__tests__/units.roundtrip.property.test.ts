import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuantity } from '../units.js';
import { arbQuantity } from './generators.js';
import { propConfig } from './support.js';

// Feature: golem-ears, Property 6: Quantity text round trip
// **Validates: Requirements 2.12**
describe('quantity text round trip', () => {
  it('parsing a quantity text returns the same kind, si and text', () => {
    fc.assert(
      fc.property(arbQuantity(), (q) => {
        const r = parseQuantity(q.text);
        expect(r.diagnostics).toEqual([]);
        expect(r.quantity).toBeDefined();
        expect(r.quantity!.text).toBe(q.text);
        expect(r.quantity!.si).toBe(q.si);
        expect(r.quantity!.kind).toBe(q.kind);
      }),
      propConfig,
    );
  });
});
