import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 18: a pinned seed with robustness not above zero breaks the requirement', () => {
  // Feature: golem-kit, Property 18: A pinned seed with robustness not above zero breaks the requirement
  it('is broken whenever any pinned seed re-runs at robustness <= 0, and decided by the quick budget only when all hold', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom(-0.5, -1e-9, 0, 1e-9, 0.3), { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      async (rerun, quickBudgetBreaks) => {
        const seeds = rerun.map((_, i) => i + 1);
        const h = createHarness({
          requirements: GREEN_REQUIREMENTS,
          trial: (_req, spec) => {
            const i = seeds.indexOf(spec.seed);
            const r = i >= 0 ? (rerun[i] as number) : quickBudgetBreaks ? -0.2 : 0.4;
            return { spec, robustness: r, worstAt: 0, unit: 'm', wallMs: 0 };
          },
        });
        const entries = seeds.map((seed, i) => ({ reqId: '1.1', scenario: { 'push.force': 10 + i }, seed, robustness: -0.1, shrunk: true, foundAfter: 1 }));
        h.fs.put(h.path('.golem/seeds/tiny/1.1.json'), `${JSON.stringify(entries)}\n`);
        const code = await h.run('gate', '--json');
        const v = JSON.parse(h.io.stdoutText().trim().split('\n').pop() as string).verdicts.find((x: { reqId: string }) => x.reqId === '1.1');
        const anyFailing = rerun.some((r) => r <= 0);
        if (anyFailing) {
          expect(v.status).toBe('broken');
          expect(code).toBe(2);
        } else {
          expect(v.status).toBe(quickBudgetBreaks ? 'broken' : 'held');
        }
      },
    ), { ...propConfig, numRuns: 100 });
  });
});
