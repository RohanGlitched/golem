import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RED_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { propConfig } from '../../../test/support/prop.js';

const LINES = RED_REQUIREMENTS.split('\n');
const head = LINES.slice(0, LINES.findIndex((l) => l.startsWith('1. ')));
const criteria = LINES.filter((l) => /^\d\. /.test(l));

const stripVolatile = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'ms' || k === 'wallMs' || k === 'durationS' ? 0 : x)));

describe('Property 40: golem test is deterministic for a fixed seed', () => {
  // Feature: golem-kit, Property 40: `golem test` is deterministic for a fixed seed
  it('gives byte-identical requirement lines and equal report verdicts apart from timings', async () => {
    await fc.assert(fc.asyncProperty(
      fc.subarray(criteria, { minLength: 1 }), fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 0xffffffff }),
      async (chosen, budget, seed) => {
        const text = [...head, ...chosen].join('\n');
        const run = async () => {
          const h = createHarness({ requirements: text });
          const code = await h.run('test', '--budget', String(budget), '--search-seed', String(seed));
          return { code, out: h.io.stdoutText(), report: stripVolatile(h.report()) };
        };
        const [a, b] = [await run(), await run()];
        expect(b.out).toBe(a.out);
        expect(b.code).toBe(a.code);
        expect(b.report).toEqual(a.report);
      },
    ), propConfig);
  });
});
