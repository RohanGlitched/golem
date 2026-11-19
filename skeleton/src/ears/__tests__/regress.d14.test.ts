// Regression tests for defect 14 (minor items) of golem-ears-hardening.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Lexicon, PredicateTemplate, Trace } from '../types.js';
import * as units from '../units.js';

const earsDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const trace = (): Trace => ({
  t: Float64Array.from([0, 1, 2]),
  signals: { h: Float64Array.from([1, 1, 1]), g: Float64Array.from([1, 1, 1]) },
  events: [],
});

describe('defect 14: minor items', () => {
  it('editDistance.ts has no byte-order mark', () => {
    const text = readFileSync(join(earsDir, 'editDistance.ts'), 'utf8');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('exports one number pattern that the tokenizer and the unit parser share', () => {
    const source = (units as Record<string, unknown>)['NUMBER_SOURCE'];
    expect(typeof source).toBe('string');
    const full = new RegExp(`^${source as string}$`);
    for (const ok of ['0', '-2.5', '+1e3', '6.02E-23']) expect(full.test(ok)).toBe(true);
    for (const bad of ['1.', '.5', 'e3', '1e']) expect(full.test(bad)).toBe(false);
    for (const file of ['tokenizer.ts', 'units.ts']) {
      const text = readFileSync(join(earsDir, file), 'utf8');
      expect(text.includes(String.raw`\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`), file).toBe(file === 'units.ts');
    }
  });

  it('returns NaN with unit signal when a signal array is shorter or longer than t', () => {
    const lex: Lexicon = {
      robotNames: ['robot'], perturbations: [],
      predicates: [{ phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5 }],
    };
    const req = compileRequirement('THE robot SHALL stay upright', lex).requirement!;
    for (const h of [Float64Array.from([1, 1]), Float64Array.from([1, 1, 1, -5])]) {
      const tr = trace();
      tr.signals['h'] = h;
      expect(req.monitor(tr)).toEqual({ robustness: NaN, worstAt: 0, unit: 'signal' });
    }
  });

  it('gives margin functions records that cannot leak between calls or predicates', () => {
    const seen: object[] = [];
    const writer: PredicateTemplate = {
      phrase: 'keep its pelvis above {length}', signals: ['h'], unit: 'm',
      margin: (s, k) => {
        seen.push(s);
        const before = k['length']!;
        try { (k as Record<string, number>)['length'] = before + 10; } catch { /* frozen */ }
        (s as Record<string, number>)['h'] = -100; // a write must not survive to the next sample
        return 1 - before;
      },
    };
    const state: PredicateTemplate = {
      phrase: 'be standing', signals: ['g'], unit: 'm', margin: (s) => { seen.push(s); return s['g']!; },
    };
    const lex: Lexicon = { robotNames: ['robot'], perturbations: [], predicates: [writer, state] };
    const ubi = compileRequirement('THE robot SHALL keep its pelvis above 0.25 m', lex).requirement!;
    const first = ubi.monitor(trace());
    const second = ubi.monitor(trace());
    expect(first).toEqual({ robustness: 0.75, worstAt: 0, unit: 'm' });
    expect(second).toEqual(first);
    // One record per monitor call: the two calls never share an object.
    expect(seen[0]).not.toBe(seen[3]);

    seen.length = 0;
    const st = compileRequirement('WHILE be standing THE robot SHALL keep its pelvis above 0.25 m', lex).requirement!;
    st.monitor(trace());
    // Response and state margins get different records.
    expect(seen[0]).not.toBe(seen[1]);
  });
});
