// golem-kit 0.1.2: the gate's confirmation pass. A quick green is confirmed with a second, independent search seed
// before it is printed (experiment 3b: agents trusted a 24-trial green that another search seed broke).
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload, type Harness } from '../../../test/support/harness.js';
import type { TestDepsOptions } from '../../../test/support/test-deps.js';
import { CONFIRM_SALT, confirmSeed } from '../confirm.js';
import { GATE_QUICK_TRIALS } from '../service.js';

const SECOND_OF_1 = confirmSeed(1);

/** One line, Expected_Hold by default, holds up to 100 N for the fake trials below. Its id is 1.1. */
const ONE = `# Requirements Document

### Requirement 1: Height

#### Acceptance Criteria

1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.4 m for 1 s
`;

type Trial = NonNullable<TestDepsOptions['trial']>;

/** A requirement that is flat (margin +0.5 m) except inside a needle of the force axis, where it breaks (margin -0.5 m). */
const needle = (lo: number, hi: number): Trial => (_req, spec) => {
  const f = spec.scenario['push.force'] ?? 0;
  return { spec, robustness: f >= lo && f <= hi ? -0.5 : 0.5, worstAt: 0.5, unit: 'm', wallMs: 0 };
};

describe('the second search seed', () => {
  it('is a uint32 that is not 0 and not the first seed, for any first seed (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (s) => {
      const c = confirmSeed(s);
      expect(Number.isInteger(c) && c >= 1 && c <= 0xffffffff).toBe(true);
      expect(c).not.toBe(s);
    }), { numRuns: 500 });
  });

  it('is a pure function of the first seed (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (s) => { expect(confirmSeed(s)).toBe(confirmSeed(s)); }), { numRuns: 200 });
  });

  it('differs for different first seeds, and is not the first seed plus a constant', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    expect(new Set(seeds.map(confirmSeed)).size).toBe(seeds.length);
    expect(new Set(seeds.map((s) => (confirmSeed(s) - s) >>> 0)).size).toBeGreaterThan(190);
  });

  it('never returns 0 or the first seed at the two inputs where one mixing step would', () => {
    // fmix32 maps 0 to 0, so the first seed that XORs to 0 with the salt would give 0.
    expect(confirmSeed(CONFIRM_SALT)).toBeGreaterThanOrEqual(1);
    expect(confirmSeed(CONFIRM_SALT)).not.toBe(CONFIRM_SALT);
  });

  it('is fixed: seed 1 confirms with the seed the documentation names', () => {
    // The value printed in the kit steering (kiro-pack/steering/golem-ears.md) and the README.
    expect(SECOND_OF_1).toBe(588244584);
    expect(confirmSeed(2)).toBe(2830249567);
  });
});

describe('a green gate is confirmed', () => {
  it('searches every Expected_Hold line twice with two seeds and says so, with both seeds and the total trials', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate')).toBe(0);
    expect(h.spies.poolSpecs).toHaveLength(2 * 3 * GATE_QUICK_TRIALS);
    const out = h.io.stdoutText();
    expect(out).toMatch(/^no counterexample in 144 trials \(3 requirements/);
    expect(out).toContain('confirmed: 3 Expected_Hold lines searched again with a second search seed derived from the first');
    expect(out).toContain(`search seed 1, then confirmation seed ${SECOND_OF_1}`);
    expect(out).toContain('24 trials per line');
    expect(out).toContain('72 confirmation trials, 144 in total');
  });

  it('draws the second pass from the derived seed: its trials differ from the first pass', async () => {
    const h = createHarness({ requirements: ONE });
    await h.run('gate');
    const specs = h.spies.poolSpecs;
    expect(specs).toHaveLength(2 * GATE_QUICK_TRIALS);
    const a = specs.slice(0, GATE_QUICK_TRIALS).map((s) => s.seed);
    const b = specs.slice(GATE_QUICK_TRIALS).map((s) => s.seed);
    expect(b).not.toEqual(a);
    expect(a.filter((s) => b.includes(s))).toHaveLength(0);
  });

  it('is deterministic: the same gate twice runs the same trials', async () => {
    const a = createHarness({ requirements: GREEN_REQUIREMENTS });
    const b = createHarness({ requirements: GREEN_REQUIREMENTS });
    await a.run('gate');
    await b.run('gate');
    expect(a.spies.poolSpecs).toEqual(b.spies.poolSpecs);
  });

  it('derives the second seed from --search-seed', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('gate', '--search-seed', '7');
    expect(h.io.stdoutText()).toContain(`search seed 7, then confirmation seed ${confirmSeed(7)}`);
    expect(h.report().meta.confirm).toMatchObject({ status: 'confirmed', firstSeed: 7, secondSeed: confirmSeed(7) });
  });

  it('derives the second seed from the Config_File searchSeed when no flag is given', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    h.fs.put(h.path('golem.config.json'), '{\n  "app": "./app.js",\n  "requirements": [".kiro/specs/tiny/requirements.md"],\n  "robot": "tiny",\n  "searchSeed": 9\n}\n');
    await h.run('gate');
    expect(h.report().meta.confirm).toMatchObject({ firstSeed: 9, secondSeed: confirmSeed(9) });
  });

  it('records the pass in the report: meta.confirm and a confirmation on each verdict', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('gate');
    const r = h.report();
    expect(r.meta.confirm).toEqual({
      status: 'confirmed', firstSeed: 1, secondSeed: SECOND_OF_1, budget: { maxTrials: 24 }, reqIds: ['1.1', '1.2', '1.3'], failedIds: [], trials: 72,
    });
    for (const v of r.verdicts) {
      expect(v.confirmation).toEqual({ firstSeed: 1, secondSeed: SECOND_OF_1, firstTrials: 24, secondTrials: 24, firstStatus: 'held', secondStatus: 'held' });
    }
  });

  it('prints the confirmation on stderr under --kiro and allows the stop', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    h.io.setStdin(stopPayload('s1'));
    expect(await h.run('gate', '--kiro')).toBe(0);
    expect(h.io.stdoutText()).toBe('');
    expect(h.io.stderrText()).toContain(`search seed 1, then confirmation seed ${SECOND_OF_1}`);
    expect(h.io.stderrText()).toMatch(/144 in total/);
  });

  it('prints the same under --json', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--json')).toBe(0);
    const j = JSON.parse(h.io.stdoutText());
    expect(j.confirm).toMatchObject({ status: 'confirmed', firstSeed: 1, secondSeed: SECOND_OF_1, trials: 72 });
    expect(j.totalTrials).toBe(144);
  });

  it('with an Expectation table: confirms the Expected_Hold lines only, and retries the Expected_Break line first', async () => {
    const text = GREEN_REQUIREMENTS.replace('### Requirement 1', '\n| Criterion | Topic | Expectation |\n|---|---|---|\n| 1.3 | x | Expected_Break |\n\n### Requirement 1')
      .replace('up to 100 N THE robot SHALL keep its tilt below 0.5 rad', 'up to 200 N THE robot SHALL keep its tilt below 0.005 rad');
    const h = createHarness({ requirements: text });
    expect(await h.run('gate')).toBe(0);
    expect(h.report().meta.confirm).toMatchObject({ status: 'confirmed', reqIds: ['1.1', '1.2'] });
    expect(h.io.stdoutText()).toContain('gate GREEN: every requirement meets its expectation (2 held as expected, 1 broke as expected');
    expect(h.io.stdoutText()).toContain('confirmed: 2 Expected_Hold lines');
  });
});

describe('--confirm-budget and --no-confirm', () => {
  it('--no-confirm runs the first pass only, says the green is not confirmed, and records the skip', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--no-confirm')).toBe(0);
    expect(h.spies.poolSpecs).toHaveLength(3 * GATE_QUICK_TRIALS);
    expect(h.io.stdoutText()).toContain('NOT confirmed (--no-confirm): each line was searched once, with search seed 1; 72 trials in total');
    expect(h.report().meta.confirm).toMatchObject({ status: 'skipped', firstSeed: 1, secondSeed: SECOND_OF_1, trials: 0 });
    expect(h.report().verdicts[0].confirmation).toBeUndefined();
  });

  it('--confirm-budget n searches n trials per line in the confirmation pass', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--confirm-budget', '10')).toBe(0);
    expect(h.spies.poolSpecs).toHaveLength(3 * GATE_QUICK_TRIALS + 3 * 10);
    expect(h.report().meta.confirm).toMatchObject({ status: 'confirmed', budget: { maxTrials: 10 }, trials: 30 });
  });

  it('with --budget n and no --confirm-budget the confirmation searches n trials as well', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--budget', '12')).toBe(0);
    expect(h.spies.poolSpecs).toHaveLength(2 * 3 * 12);
    expect(h.report().meta.confirm).toMatchObject({ budget: { maxTrials: 12 } });
  });

  it('adds the pinned seeds on top of --confirm-budget: they re-run first and do not use up the search', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    await h.run('falsify', '1.2', '--budget', '24');
    const fixed = RED_REQUIREMENTS.replace('up to 200 N', 'up to 100 N');
    h.fs.put(h.path('.kiro/specs/tiny/requirements.md'), fixed);
    h.spies.poolSpecs.length = 0;
    // The pinned seed of 1.2 is out of range now? It is not: 150 N or more is inside 0-200 N but not 0-100 N, so it is skipped.
    await h.run('gate', '--confirm-budget', '5');
    expect(h.spies.poolSpecs.filter((s) => s.reqId === '1.2')).toHaveLength(24 + 5);
  });

  it('rejects --no-confirm together with --confirm-budget (exit 1, no trial)', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--no-confirm', '--confirm-budget', '5')).toBe(1);
    expect(h.io.stderrText()).toContain('--no-confirm and --confirm-budget cannot be used together');
    expect(h.spies.poolSpecs).toHaveLength(0);
  });

  it('rejects a --confirm-budget that is not a positive integer', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate', '--confirm-budget', '0')).toBe(1);
    expect(h.spies.poolSpecs).toHaveLength(0);
  });
});

describe('a line that holds under the first seed and breaks under the second makes the gate RED', () => {
  let eligible: { lo: number; hi: number }[] = [];
  const gateWith = async (trial: Trial, ...args: string[]): Promise<{ code: number; h: Harness }> => {
    const h = createHarness({ requirements: ONE, trial });
    return { code: await h.run('gate', ...args), h };
  };

  beforeAll(async () => {
    // Needles of 3 N on the 0-100 N axis that the search with seed 1 misses and the search with the derived seed finds.
    const found: { lo: number; hi: number }[] = [];
    for (let c = 3; c <= 97; c += 1) {
      const t = needle(c - 1.5, c + 1.5);
      const a = await gateWith(t, '--no-confirm');
      if (a.code !== 0) continue;
      const b = await gateWith(t, '--no-confirm', '--search-seed', String(SECOND_OF_1));
      if (b.code === 2) found.push({ lo: c - 1.5, hi: c + 1.5 });
    }
    eligible = found;
  }, 120000);

  it('has needles that seed 1 misses and the derived seed finds (the test construction)', () => {
    expect(eligible.length).toBeGreaterThanOrEqual(3);
  });

  it('exits 2 and says: held under the first seed, broke under the second, with both seeds, the reproduce command and a pinned seed', async () => {
    const n = eligible[0] as { lo: number; hi: number };
    const { code, h } = await gateWith(needle(n.lo, n.hi));
    expect(code).toBe(2);
    const out = h.io.stdoutText();
    expect(out).toContain(`held under search seed 1 (24 trials) and broke under confirmation seed ${SECOND_OF_1} (`);
    expect(out).toContain('reproduce: npx golem-spec replay 1.1');
    expect(out).toContain(`search again: npx golem-spec falsify 1.1 --search-seed ${SECOND_OF_1} --budget 24`);
    expect(out).toContain('NOT confirmed: 1.1 held under search seed 1 and did not hold under confirmation seed');
    expect(out).toContain('gate RED');
    expect(out).not.toContain('gate GREEN');
    expect(out).not.toMatch(/^no counterexample in/m);
    const pinned = JSON.parse(h.fs.text(h.path('.golem/seeds/tiny/1.1.json')) as string);
    expect(pinned).toHaveLength(1);
    const f = pinned[0].scenario['push.force'];
    expect(f).toBeGreaterThanOrEqual(n.lo);
    expect(f).toBeLessThanOrEqual(n.hi);
  });

  it('records the broken verdict, both seeds and the confirmation in the report', async () => {
    const n = eligible[0] as { lo: number; hi: number };
    const { h } = await gateWith(needle(n.lo, n.hi));
    const r = h.report();
    expect(r.meta.lastGateExitCode).toBe(2);
    expect(r.meta.confirm).toMatchObject({ status: 'broke', firstSeed: 1, secondSeed: SECOND_OF_1, failedIds: ['1.1'] });
    expect(r.verdicts[0]).toMatchObject({ reqId: '1.1', status: 'broken', met: false, confirmation: { firstSeed: 1, secondSeed: SECOND_OF_1, secondStatus: 'broken', firstStatus: 'held' } });
  });

  it('blocks the stop under --kiro with the same words, and pins the seed', async () => {
    const n = eligible[0] as { lo: number; hi: number };
    const h = createHarness({ requirements: ONE, trial: needle(n.lo, n.hi) });
    h.io.setStdin(stopPayload('s1'));
    expect(await h.run('gate', '--kiro')).toBe(0);
    const block = JSON.parse(h.io.stdoutText());
    expect(block.decision).toBe('block');
    expect(block.reason).toContain(`held under search seed 1 (24 trials) and broke under confirmation seed ${SECOND_OF_1}`);
    expect(block.reason).toContain('reproduce: npx golem-spec replay 1.1');
    expect(h.fs.text(h.path('.golem/seeds/tiny/1.1.json'))).toBeDefined();
    expect(h.io.stderrText()).toContain('NOT confirmed');
  });

  it('is red on the next run too: the pinned seed re-runs first and the first pass fails', async () => {
    const n = eligible[0] as { lo: number; hi: number };
    const h = createHarness({ requirements: ONE, trial: needle(n.lo, n.hi) });
    expect(await h.run('gate')).toBe(2);
    h.clearOutput();
    expect(await h.run('gate')).toBe(2);
    expect(h.report().meta.confirm).toMatchObject({ status: 'unmet' });
  });

  it('without the confirmation the same line is green: that is the weakness the pass closes', async () => {
    const n = eligible[0] as { lo: number; hi: number };
    expect((await gateWith(needle(n.lo, n.hi), '--no-confirm')).code).toBe(0);
  });

  it('PROPERTY: a line whose failure region is found by seed B but not by seed A never produces GREEN', async () => {
    expect(eligible.length).toBeGreaterThan(0);
    await fc.assert(fc.asyncProperty(fc.constantFrom(...eligible), async (n) => {
      const a = await gateWith(needle(n.lo, n.hi), '--no-confirm');
      const b = await gateWith(needle(n.lo, n.hi), '--no-confirm', '--search-seed', String(SECOND_OF_1));
      expect([a.code, b.code]).toEqual([0, 2]);
      const { code, h } = await gateWith(needle(n.lo, n.hi));
      expect(code).toBe(2);
      expect(h.io.stdoutText()).not.toContain('GREEN');
      expect(h.io.stdoutText()).toContain(`confirmation seed ${SECOND_OF_1}`);
      const kiro = createHarness({ requirements: ONE, trial: needle(n.lo, n.hi) });
      kiro.io.setStdin(stopPayload('p'));
      await kiro.run('gate', '--kiro');
      expect(JSON.parse(kiro.io.stdoutText()).decision).toBe('block');
    }), { numRuns: 25 });
  }, 120000);

  it('a line that breaks under seed A is red from the first pass, and no confirmation runs', async () => {
    const { code, h } = await gateWith(needle(0, 100));
    expect(code).toBe(2);
    expect(h.report().meta.confirm.status).toBe('unmet');
    expect(h.io.stdoutText()).not.toContain('confirmation seed');
  });

  it('a line that holds under both seeds is green and confirmed', async () => {
    const { code, h } = await gateWith(needle(200, 300));
    expect(code).toBe(0);
    expect(h.io.stdoutText()).toContain('confirmed: 1 Expected_Hold line searched again');
  });
});

describe('the confirmation fails closed', () => {
  it('an error in the confirmation run is RED, not green', async () => {
    let calls = 0;
    const h = createHarness({
      requirements: ONE,
      trial: (_req, spec) => {
        if (++calls > GATE_QUICK_TRIALS) throw new Error('simulator crashed');
        return { spec, robustness: 0.5, worstAt: 0, unit: 'm', wallMs: 0 };
      },
    });
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stdoutText()).toContain('ended in an error under confirmation seed');
    expect(h.io.stdoutText()).toContain('error: simulator crashed');
    expect(h.io.stdoutText()).not.toContain('GREEN');
    expect(h.report().meta.confirm).toMatchObject({ status: 'broke', failedIds: ['1.1'] });
    expect(h.report().verdicts[0]).toMatchObject({ status: 'error', met: false });
  });

  it('a red first pass does not run the confirmation and says so in the report', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    expect(await h.run('gate')).toBe(2);
    const base = createHarness({ requirements: RED_REQUIREMENTS });
    await base.run('gate', '--no-confirm');
    expect(h.spies.poolSpecs).toEqual(base.spies.poolSpecs);
    expect(h.report().meta.confirm).toMatchObject({ status: 'unmet', firstSeed: 1, secondSeed: SECOND_OF_1 });
  });

  it('a spec with only Expected_Break lines has nothing to confirm', async () => {
    const text = RED_REQUIREMENTS.replace('### Requirement 1', '\n| Criterion | Topic | Expectation |\n|---|---|---|\n| 1.2 | x | Expected_Break |\n\n### Requirement 1')
      .replace('up to 100 N THE robot SHALL keep its height', 'up to 200 N THE robot SHALL keep its height').replace('up to 100 N THE robot SHALL keep its tilt below 0.5 rad', 'up to 200 N THE robot SHALL keep its tilt below 0.005 rad');
    const h = createHarness({ requirements: text.replace(/\| 1\.2 \| x \| Expected_Break \|/, '| 1.1 | x | Expected_Break |\n| 1.2 | x | Expected_Break |\n| 1.3 | x | Expected_Break |') });
    expect(await h.run('gate')).toBe(0);
    expect(h.report().meta.confirm).toMatchObject({ status: 'none', reqIds: [] });
  });

  it('uses one pool for both passes', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('gate');
    expect(h.spies.createPool).toBe(1);
    expect(h.spies.poolClose).toBe(1);
  });
});
