// golem-gate-hardening task 7 (defect 8): a line marked Expected_Break that holds is run again at 4 times the budget.
// Tests that count trials run with --no-confirm, so that they count the retry alone (the confirmation pass has its own tests).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload } from '../../../test/support/harness.js';
import { TINY_IDS, arbMark, tableText, type Mark } from '../../../test/support/table-gen.js';
import { GATE_QUICK_TRIALS, toFalsifyOptions } from '../service.js';

/**
 * One requirement that breaks above about 149 N, marked Expected_Break. Search seeds 2, 15 and 58 miss it within 24 trials at 160 N
 * (audit probe 5; its seed 0 is a usage error, exit 1, not a miss, so the 175 N and 200 N rows of the audit never failed).
 */
const single = (max: number): string => `# Requirements Document

| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Height | Expected_Break |

### Requirement 1: Height

#### Acceptance Criteria

1. WHEN the base is pushed with up to ${max} N THE robot SHALL keep its height above 0.4 m for 1 s
`;
const withTable = (text: string, rows: string[]): string =>
  text.replace('### Requirement 1', `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n\n### Requirement 1`);

describe('a held Expected_Break line is searched again at 4 times the budget', () => {
  it.each([2, 15, 58])('turns green at search seed %i for a line that breaks above 149 N (up to 160 N), and pins the seed it finds', async (seed) => {
    const h = createHarness({ requirements: single(160) });
    expect(await h.run('gate', '--search-seed', String(seed))).toBe(0);
    expect(h.io.stdoutText()).toContain('gate GREEN');
    expect(h.spies.poolSpecs.length).toBeGreaterThan(GATE_QUICK_TRIALS);
    const pinned = JSON.parse(h.fs.text(h.path('.golem/seeds/tiny/1.1.json')) as string);
    expect(pinned).toHaveLength(1);
    expect(h.report().verdicts[0]).toMatchObject({ status: 'broken', expectation: 'Expected_Break', met: true });
  });

  it('does the same under --kiro: the stop is allowed with nothing on stdout', async () => {
    const h = createHarness({ requirements: single(160) });
    h.clock.advance(3000);
    h.io.setStdin(stopPayload('s1'));
    expect(await h.run('gate', '--kiro', '--search-seed', '2')).toBe(0);
    expect(h.io.stdoutText()).toBe('');
    expect(h.io.stderrText()).toContain('gate GREEN');
  });

  it('stays red for a line that really holds, and says the budget that decided (96 trials)', async () => {
    const h = createHarness({ requirements: single(100) });
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stdoutText()).toMatch(/expected to break but held within budget 96 trials/);
    expect(h.spies.poolSpecs).toHaveLength(GATE_QUICK_TRIALS + 4 * GATE_QUICK_TRIALS);
  });

  it('scales with --budget: 12 trials, then 48', async () => {
    const h = createHarness({ requirements: single(100) });
    expect(await h.run('gate', '--budget', '12')).toBe(2);
    expect(h.io.stdoutText()).toMatch(/held within budget 48 trials/);
    expect(h.spies.poolSpecs).toHaveLength(12 + 48);
  });

  it('runs every other line once: no mark, a mark on a broken line, a mark on a line that holds', async () => {
    const none = createHarness({ requirements: RED_REQUIREMENTS });
    await none.run('gate', '--no-confirm');
    const base = none.spies.poolSpecs.length;
    const brokenMarked = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']) });
    await brokenMarked.run('gate', '--no-confirm');
    expect(brokenMarked.spies.poolSpecs).toHaveLength(base);
    const holdMarked = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.1 | x | Expected_Hold |', '| 1.2 | x | Expected_Hold |']) });
    await holdMarked.run('gate', '--no-confirm');
    expect(holdMarked.spies.poolSpecs).toHaveLength(base);
    const heldMarked = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.3 | x | Expected_Break |']) });
    await heldMarked.run('gate', '--no-confirm');
    expect(heldMarked.spies.poolSpecs).toHaveLength(base + 4 * GATE_QUICK_TRIALS);
  });

  it('uses one pool for both passes', async () => {
    const h = createHarness({ requirements: single(100) });
    await h.run('gate');
    expect(h.spies.createPool).toBe(1);
    expect(h.spies.poolClose).toBe(1);
  });

  it('is deterministic: the same search seed gives the same trials twice', async () => {
    const a = createHarness({ requirements: single(100) });
    const b = createHarness({ requirements: single(100) });
    await a.run('gate', '--search-seed', '5');
    await b.run('gate', '--search-seed', '5');
    expect(a.spies.poolSpecs).toEqual(b.spies.poolSpecs);
  });
});

describe('the budget of the retry (toFalsifyOptions, gate-retry)', () => {
  const app = { config: { searchSeed: 1 } } as never;
  const opts = (o: { budget?: number; timeS?: number }, pinned: number) =>
    toFalsifyOptions({ mode: 'full', budgetKind: 'gate-retry', ...o }, app, pinned, 'tiny').budget;

  it('is 4 times the quick budget plus the valid pinned seeds without a flag', () => {
    expect(opts({}, 0)).toEqual({ maxTrials: 96 });
    expect(opts({}, 3)).toEqual({ maxTrials: 99 });
  });

  it('is 4 times --budget and 4 times --time when given', () => {
    expect(opts({ budget: 10 }, 3)).toEqual({ maxTrials: 40 });
    expect(opts({ timeS: 2 }, 3)).toEqual({ maxWallMs: 8000 });
    expect(opts({ budget: 10, timeS: 2 }, 0)).toEqual({ maxTrials: 40, maxWallMs: 8000 });
  });
});

describe('which lines are retried (property)', () => {
  it('adds exactly 96 trials per Expected_Break line that held, and changes no verdict of another line', async () => {
    const baseline = createHarness({ requirements: RED_REQUIREMENTS });
    await baseline.run('gate', '--no-confirm');
    const baseTrials = baseline.spies.poolSpecs.length;
    const baseVerdicts = baseline.report().verdicts.map((v: { reqId: string; status: string }) => [v.reqId, v.status]);
    await fc.assert(fc.asyncProperty(fc.array(arbMark, { minLength: 3, maxLength: 3 }), async (marks) => {
      const rows = TINY_IDS.map((id, i) => [id, marks[i] as Mark] as const);
      const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows)}\n### Requirement 1`) });
      await h.run('gate', '--no-confirm');
      // 1.1 and 1.3 hold at every budget and 1.2 breaks; a mark of Expected_Break on a held line triggers the retry.
      const retried = (marks[0] === 'Expected_Break' ? 1 : 0) + (marks[2] === 'Expected_Break' ? 1 : 0);
      expect(h.spies.poolSpecs.length).toBe(baseTrials + retried * 4 * GATE_QUICK_TRIALS);
      expect(h.report().verdicts.map((v: { reqId: string; status: string }) => [v.reqId, v.status])).toEqual(baseVerdicts);
    }), { numRuns: 100 });
  });

  it('never retries when every line is marked Expected_Hold or breaks (property over the GREEN controller)', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }), async (brk) => {
      const rows = TINY_IDS.map((id, i) => [id, brk[i] ? 'Expected_Break' : 'Expected_Hold'] as const);
      const h = createHarness({ requirements: GREEN_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows as never)}\n### Requirement 1`) });
      await h.run('gate', '--no-confirm');
      expect(h.spies.poolSpecs.length).toBe(3 * GATE_QUICK_TRIALS + brk.filter(Boolean).length * 4 * GATE_QUICK_TRIALS);
    }), { numRuns: 50 });
  });
});
