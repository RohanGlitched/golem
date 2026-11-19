import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkJson, diagnosticText, sortDiagnostics } from '../format.js';
import type { FileDiagnostic } from '../types.js';
import { propConfig } from '../../../test/support/prop.js';

const files = ['a.md', 'b.md', 'c.md'];
const arbDiag: fc.Arbitrary<FileDiagnostic> = fc.record({
  file: fc.constantFrom(...files),
  line: fc.integer({ min: 1, max: 30 }),
  column: fc.integer({ min: 1, max: 30 }),
  severity: fc.constantFrom('error' as const, 'warning' as const),
  kind: fc.constant('UNKNOWN_PHRASE' as const),
  message: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[\r\n]/g, ' ')),
  start: fc.constant(0), end: fc.constant(1),
  suggestion: fc.option(fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[\r\n]/g, ' ')), { nil: undefined }),
}, { requiredKeys: ['file', 'line', 'column', 'severity', 'kind', 'message', 'start', 'end'] });

describe('Property 25: diagnostics are ordered and formatted', () => {
  // Feature: golem-kit, Property 25: Diagnostics are ordered and formatted
  it('orders by file order, line and column, keeping every diagnostic', () => {
    fc.assert(fc.property(fc.array(arbDiag, { maxLength: 15 }), fc.shuffledSubarray(files, { minLength: 3 }), (ds, order) => {
      const s = sortDiagnostics(ds, order);
      expect(s).toHaveLength(ds.length);
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1] as FileDiagnostic;
        const b = s[i] as FileDiagnostic;
        const key = (x: FileDiagnostic): number[] => [order.indexOf(x.file), x.line, x.column];
        const [ka, kb] = [key(a), key(b)];
        expect(ka[0]! < kb[0]! || (ka[0] === kb[0] && (ka[1]! < kb[1]! || (ka[1] === kb[1] && ka[2]! <= kb[2]!)))).toBe(true);
      }
    }), propConfig);
  });

  it('prints file:line:col: severity: message and a suggestion line when present', () => {
    fc.assert(fc.property(arbDiag, (d) => {
      const lines = diagnosticText(d).split('\n');
      expect(lines[0]).toBe(`${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`);
      expect(lines.length).toBe(d.suggestion !== undefined ? 2 : 1);
      if (d.suggestion !== undefined) expect(lines[1]).toContain(d.suggestion);
    }), propConfig);
  });

  it('is not ok exactly when some diagnostic has severity error', () => {
    fc.assert(fc.property(fc.array(arbDiag, { maxLength: 10 }), (ds) => {
      const j = checkJson([], ds);
      expect(j.ok).toBe(!ds.some((d) => d.severity === 'error'));
      j.diagnostics.forEach((x, i) => expect(x.suggestion).toBe((ds[i] as FileDiagnostic).suggestion ?? null));
    }), propConfig);
  });
});
