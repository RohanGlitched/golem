import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseEntries, normaliseLine } from '../proposals.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { propConfig } from '../../../test/support/prop.js';

const GOOD = (n: number): string => `WHEN the base is pushed with up to ${n} N THE robot SHALL keep its height above 0.4 m for 1 s`;
/** Extra spaces around THE and SHALL only: the tokenizer wants a number and its unit one space apart. */
const spaced = (s: string, k: number): string => s.replace(' THE robot SHALL ', `${' '.repeat(1 + (k % 3))}THE${' '.repeat(1 + (k % 3))}robot SHALL `);

interface Case { text: string; compiles: boolean; dup?: 'requirements' }
const arbText: fc.Arbitrary<Case> = fc.oneof(
  fc.integer({ min: 101, max: 400 }).map((n) => ({ text: GOOD(n), compiles: true })),
  fc.integer({ min: 101, max: 400 }).map((n) => ({ text: GOOD(n).replace('height', 'heigth'), compiles: false })),
  fc.constant({ text: 'THE robot SHALL fly', compiles: false }),
  fc.constant({ text: GOOD(100), compiles: true, dup: 'requirements' as const }),
);

describe('Property 36: propose_requirement only appends accepted, new, compilable lines', () => {
  // Feature: golem-kit, Property 36: propose_requirement only appends accepted, new, compilable lines
  it('adds exactly one entry for a compiling non-duplicate line, otherwise nothing, and never touches a requirements file', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ t: arbText, k: fc.nat() }), { minLength: 1, maxLength: 6 }), async (items) => {
      const m = await createMcpHarness();
      const reqFile = m.path('.kiro/specs/tiny/requirements.md');
      const reqBefore = m.fs.text(reqFile);
      const accepted: string[] = [];
      for (const { t, k } of items) {
        const text = spaced(t.text, k);
        const file = m.path('.kiro/specs/tiny/proposals.md');
        const old = m.fs.text(file) ?? '';
        const r = await m.call('propose_requirement', { text });
        const dupOfProposal = accepted.some((a) => normaliseLine(a) === normaliseLine(text));
        const expectRecorded = t.compiles && t.dup === undefined && !dupOfProposal;
        expect(r.isError).toBe(false);
        expect(r.json.recorded).toBe(expectRecorded);
        const now = m.fs.text(file) ?? '';
        if (expectRecorded) {
          accepted.push(text);
          expect(now.slice(0, old.length)).toBe(old);
          expect(parseEntries(now).entries.length).toBe(parseEntries(old).entries.length + 1);
          expect(parseEntries(now).entries.at(-1)?.text).toBe(text);
        } else {
          expect(now).toBe(old);
        }
        expect(m.fs.text(reqFile)).toBe(reqBefore);
      }
    }), { ...propConfig, numRuns: 50 });
  });
});
