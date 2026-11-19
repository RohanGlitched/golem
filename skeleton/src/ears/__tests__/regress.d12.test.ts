// Regression test for defect 12: diagnostics quoted keywords upper-cased instead of as written.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Lexicon } from '../types.js';

const lex: Lexicon = {
  robotNames: ['golem'],
  perturbations: [{ phrase: 'the pelvis is pushed with {force}', dims: () => [], apply: () => {} }],
  predicates: [{ phrase: 'keep its pelvis above {length}', signals: ['z'], unit: 'm', margin: (s, k) => s['z']! - k['length']! }],
};

describe('defect 12: messages quote the source as written', () => {
  it("quotes 'the' in a response, not 'THE'", () => {
    const r = compileRequirement('THE golem SHALL keep the pelvis above 0.6 m', lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.message).toMatch(/^'the' does not continue/);
  });

  it("never quotes 'Then' upper-cased", () => {
    const r = compileRequirement('WHEN the pelvis is pushed with 5 N Then THE golem SHALL keep its pelvis above 1 m', lex);
    const msgs = r.diagnostics.map((d) => d.message).join('\n');
    expect(msgs).not.toContain("'THEN'");
  });
});
