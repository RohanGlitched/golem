import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ACCEPTED_UNITS } from '../units.js';
import { tokenize } from '../tokenizer.js';
import { arbUnit, arbQuantity, arbLexicon, arbValidLine, arbMutation, propConfig } from './generators.js';

describe('generators', () => {
  it('arbUnit only yields accepted units', () => {
    fc.assert(fc.property(arbUnit, (u) => ACCEPTED_UNITS.includes(u)), propConfig);
  });

  it('arbQuantity writes the number, zero or one space, then a unit, and covers both spacings', () => {
    let withSpace = 0;
    let without = 0;
    fc.assert(
      fc.property(arbQuantity(), (q) => {
        const m = /^(\d+(?:\.\d+)?)( ?)(.+)$/.exec(q.text);
        expect(m).not.toBeNull();
        expect(ACCEPTED_UNITS).toContain(m![3]);
        expect(q.si).toBeGreaterThanOrEqual(0);
        if (m![2]) withSpace++; else without++;
      }),
      propConfig,
    );
    expect(withSpace).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });

  it('arbQuantity(kind) yields only that kind', () => {
    fc.assert(fc.property(arbQuantity('force'), (q) => q.kind === 'force' && /(N|kN)$/.test(q.text)), propConfig);
    fc.assert(fc.property(arbQuantity('count'), (q) => /^\d+$/.test(q.text)), propConfig);
  });

  it('arbLexicon makes 1 to 6 templates per class with unique first words', () => {
    fc.assert(
      fc.property(arbLexicon, (lex) => {
        for (const list of [lex.perturbations, lex.predicates]) {
          expect(list.length).toBeGreaterThanOrEqual(1);
          expect(list.length).toBeLessThanOrEqual(6);
          const firsts = list.map((t) => t.phrase.split(' ')[0]);
          expect(new Set(firsts).size).toBe(firsts.length);
        }
      }),
      propConfig,
    );
  });

  it('arbLexicon predicates use an above margin that is positive when the signal exceeds the bound', () => {
    fc.assert(
      fc.property(arbLexicon, (lex) => {
        const p = lex.predicates[0]!;
        const sig = p.signals[0]!;
        expect(p.margin({ [sig]: 5 }, { x: 3 })).toBe(2);
        expect(p.margin({ [sig]: 1 }, { x: 3 })).toBe(-2);
      }),
      propConfig,
    );
  });

  it('arbValidLine covers all five patterns and reports consistent spans', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex)),
        (line) => {
          seen.add(line.pattern);
          expect(line.text.slice(line.spans.robot.start, line.spans.robot.end)).toBe(line.robot);
          expect(line.text.slice(line.spans.response.start, line.spans.response.end)).toBe(line.response.text);
          if (line.condition) {
            const s = line.spans.condition!;
            expect(line.text.slice(s.start, s.end)).toBe(line.condition.text);
          }
          expect(line.condition === undefined).toBe(line.pattern === 'ubiquitous');
        },
      ),
      { ...propConfig, numRuns: 200 },
    );
    expect([...seen].sort()).toEqual(['event', 'optional', 'state', 'ubiquitous', 'unwanted']);
  });

  it('arbValidLine writes IDs without a trailing period in the expected id', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex)),
        (line) => {
          if (line.idText === undefined) {
            expect(line.id).toBeUndefined();
          } else {
            expect(line.text.startsWith(`${line.idText} `)).toBe(true);
            expect(line.id!.endsWith('.')).toBe(false);
            expect(/^(R\d+|\d+|\d+\.\d+)$/.test(line.id!)).toBe(true);
          }
        },
      ),
      propConfig,
    );
  });

  it('arbMutation changes a clause by one of the four operators', () => {
    const ops = new Set<string>();
    fc.assert(
      fc.property(arbMutation('keep pelvis above 0.5 m'), (m) => {
        ops.add(m.op);
        expect(m.changed).toBe(m.text !== 'keep pelvis above 0.5 m');
      }),
      { ...propConfig, numRuns: 200 },
    );
    expect([...ops].sort()).toEqual(['delete', 'insert', 'misspell', 'swap']);
  });

  it('tokenizes generated valid lines without diagnostics', () => {
    fc.assert(
      fc.property(
        arbLexicon.chain((lex) => arbValidLine(lex)),
        (line) => {
          const { diagnostics } = tokenize(line.text);
          expect(diagnostics).toEqual([]);
        },
      ),
      { ...propConfig, numRuns: 300 },
    );
  });
});
