import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { TraceUnavailableError } from '../deps.js';

describe('main', () => {
  it('prints usage for --help with exit 0 and does not look for a config', async () => {
    const h = createHarness({ seed: false });
    expect(await h.run('--help')).toBe(0);
    expect(h.io.stdoutText()).toContain('usage: golem');
    expect(h.spies.loadApp).toBe(0);
  });

  it('exits 1 on an argument error without creating a pool', async () => {
    const h = createHarness();
    expect(await h.run('test', '--budget', '0')).toBe(1);
    expect(h.io.stderrText()).toContain('golem: flag --budget');
    expect(h.spies.createPool).toBe(0);
  });

  it('exits 1 naming the directory when there is no config', async () => {
    const h = createHarness({ seed: false });
    expect(await h.run('check')).toBe(1);
    expect(h.io.stderrText()).toContain('golem init');
  });
});

describe('golem check', () => {
  it('exits 0 with the summary line for valid lines and touches neither pool nor trace', async () => {
    const h = createHarness();
    expect(await h.run('check')).toBe(0);
    expect(h.io.stdoutText()).toBe('3 requirements compiled, 0 warnings\n');
    expect(h.spies).toMatchObject({ createPool: 0, runTraced: 0, falsify: 0 });
  });

  it('exits 1 and prints file:line:col with the closest template for a line that matches nothing', async () => {
    const h = createHarness({ requirements: '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n' });
    expect(await h.run('check')).toBe(1);
    const out = h.io.stdoutText();
    expect(out).toMatch(/requirements\.md:5:\d+: error: /);
    expect(out).toContain('suggestion:');
    expect(out).toMatch(/0 requirements compiled, 0 warnings, 1 errors/);
  });

  it('prints one JSON object with ok, requirements and diagnostics (suggestion null when none)', async () => {
    const h = createHarness();
    expect(await h.run('check', '--json')).toBe(0);
    const j = JSON.parse(h.io.stdoutText());
    expect(j.ok).toBe(true);
    expect(j.requirements.map((r: { id: string }) => r.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(j.requirements[0]).toMatchObject({ pattern: 'event' });
  });

  it('exits 1 naming a missing file and compiles nothing else', async () => {
    const h = createHarness();
    expect(await h.run('check', 'nope.md')).toBe(1);
    expect(h.io.stderrText()).toContain('nope.md');
    expect(h.io.stdoutText()).toBe('');
  });

  it('warns about a file with no criterion and still exits 0', async () => {
    const h = createHarness({ requirements: '# Requirements\n\nNothing here.\n' });
    expect(await h.run('check')).toBe(0);
    expect(h.io.stdoutText()).toContain('warning: the file contains no acceptance criterion');
    expect(h.io.stdoutText()).toContain('0 requirements compiled, 1 warnings');
  });

  it('checks only the named file, resolved against the working directory', async () => {
    const h = createHarness();
    expect(await h.run('check', '.kiro/specs/tiny/requirements.md')).toBe(0);
  });
});

describe('golem test', () => {
  it('exits 2 when a requirement is broken, prints one line each, pins the counterexample and writes the report', async () => {
    const h = createHarness();
    expect(await h.run('test', '--budget', '24')).toBe(2);
    const lines = h.io.stdoutText().split('\n');
    expect(lines[0]).toMatch(/^1\.1  HELD  closest margin \+[\d.]+ m  no counterexample found in \d+ trials/);
    expect(lines[1]).toMatch(/^1\.2  BROKEN  margin -[\d.]+ m  \d+ trials  push\.force = [\d.]+ N  \(shrunk, seed \d+\)$/);
    expect(lines[2]).toMatch(/^1\.3  HELD/);
    expect(lines[3]).toContain('3 requirements: 1 broken, 2 held, 0 error');
    expect(lines[3]).toContain('not a proof');
    const rep = h.report();
    expect(rep.verdicts.map((v: { reqId: string }) => v.reqId)).toEqual(['1.1', '1.2', '1.3']);
    expect(rep.verdicts[1]).toMatchObject({ status: 'broken', unit: 'm' });
    expect(rep.meta).toMatchObject({ budget: { maxTrials: 24 }, searchSeed: 1 });
    expect(JSON.parse(h.fs.text(h.path('.golem/seeds/tiny/1.2.json')) as string)).toHaveLength(1);
    expect(h.spies.poolClose).toBe(1);
  });

  it('exits 0 when every requirement holds', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('test', '--budget', '24')).toBe(0);
    expect(h.io.stdoutText()).toContain('3 requirements: 0 broken, 3 held');
  });

  it('exits 1 when a requirement ends in error and none is broken', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS, trial: () => { throw new Error('simulation diverged'); } });
    expect(await h.run('test', '--budget', '8')).toBe(1);
    expect(h.io.stdoutText()).toMatch(/ERROR/);
    expect(h.io.stdoutText()).toContain('simulation diverged');
  });

  it('lists the valid ids for an unknown --req and starts no pool', async () => {
    const h = createHarness();
    expect(await h.run('test', '--req', 'R9')).toBe(1);
    expect(h.io.stderrText()).toContain('valid ids: 1.1, 1.2, 1.3');
    expect(h.spies.createPool).toBe(0);
  });

  it('with --req writes only that entry and leaves the others unchanged', async () => {
    const h = createHarness();
    await h.run('test', '--budget', '10');
    const before = h.report();
    h.clearOutput();
    expect(await h.run('test', '--req', '1.1', '--budget', '10')).toBe(0);
    const after = h.report();
    expect(after.verdicts[1]).toEqual(before.verdicts[1]);
    expect(after.verdicts[2]).toEqual(before.verdicts[2]);
    expect(h.io.stdoutText().split('\n').filter((l) => /^1\.\d/.test(l))).toHaveLength(1);
  });

  it('defaults to 64 trials and honours --time and --workers', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('test');
    expect(h.report().meta.budget).toEqual({ maxTrials: 64 });
    await h.run('test', '--time', '2', '--budget', '5');
    expect(h.report().meta.budget).toEqual({ maxTrials: 5, maxWallMs: 2000 });
  });

  it('exits 1 with the diagnostics and starts no pool when a line does not compile', async () => {
    const h = createHarness({ requirements: '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n' });
    expect(await h.run('test')).toBe(1);
    expect(h.spies.createPool).toBe(0);
    expect(h.io.stderrText()).toContain('error');
  });

  it('prints a single JSON object with verdicts and metadata for --json', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('test', '--json', '--budget', '6')).toBe(0);
    const j = JSON.parse(h.io.stdoutText());
    expect(j.verdicts).toHaveLength(3);
    expect(j.meta.budget).toEqual({ maxTrials: 6 });
  });

  it('closes the pool when a run throws', async () => {
    const h = createHarness({ falsifyImpl: async () => { throw new Error('pool exploded'); } });
    expect(await h.run('test')).toBe(1);
    expect(h.io.stderrText()).toContain('pool exploded');
    expect(h.spies.poolClose).toBe(1);
  });
});

describe('golem falsify', () => {
  it('prints a progress line per generation and the final line, and merges only that entry', async () => {
    const h = createHarness();
    expect(await h.run('falsify', '1.2', '--budget', '24')).toBe(2);
    const out = h.io.stdoutText().split('\n');
    expect(out.some((l) => /^1\.2  random generation 0: lowest [+-][\d.]+ m, \d+ trials used, \d+ remaining$/.test(l))).toBe(true);
    expect(out.some((l) => /^1\.2  BROKEN/.test(l))).toBe(true);
    expect(h.report().verdicts.map((v: { reqId: string }) => v.reqId)).toEqual(['1.2']);
  });

  it('streams JSON lines ending with the verdict', async () => {
    const h = createHarness();
    await h.run('falsify', '1.2', '--json', '--budget', '24');
    const lines = h.io.stdoutText().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'progress', reqId: '1.2' });
    expect(lines[lines.length - 1]).toMatchObject({ type: 'verdict', verdict: { reqId: '1.2', status: 'broken' } });
  });

  it('lists the ids for an unknown or missing id', async () => {
    const h = createHarness();
    expect(await h.run('falsify', 'zz')).toBe(1);
    expect(h.io.stderrText()).toContain('valid ids');
    expect(await h.run('falsify')).toBe(1);
    expect(h.spies.createPool).toBe(0);
  });
});

describe('golem replay', () => {
  it('replays the pinned counterexample, writes a CSV, prints the summary and the studio url, twice identically', async () => {
    const h = createHarness();
    await h.run('falsify', '1.2', '--budget', '24');
    h.clearOutput();
    expect(await h.run('replay', '1.2')).toBe(0);
    const out = h.io.stdoutText();
    expect(out).toMatch(/^replay 1\.2: seed \d+, push\.force = [\d.]+ N/);
    expect(out).toMatch(/robustness -[\d.]+ m at t = [\d.]+ s/);
    expect(out).toMatch(/height: min [\d.]+ m, max [\d.]+ m, at worst [\d.]+ m/);
    expect(out).toContain('trace: .golem/replays/1.2.csv (51 samples)');
    expect(out).toMatch(/studio: apps\/tiny\/web\/index\.html#r=1\.2&seed=\d+&d\.push\.force=/);
    const csv1 = h.fs.text(h.path('.golem/replays/1.2.csv')) as string;
    expect(csv1.split('\n')[0]).toBe('t,height,tilt');
    const seedsBefore = h.fs.text(h.path('.golem/seeds/tiny/1.2.json'));
    const reportBefore = h.fs.text(h.path('.golem/report.json'));
    await h.run('replay', '1.2');
    expect(h.fs.text(h.path('.golem/replays/1.2.csv'))).toBe(csv1);
    expect(h.fs.text(h.path('.golem/seeds/tiny/1.2.json'))).toBe(seedsBefore);
    expect(h.fs.text(h.path('.golem/report.json'))).toBe(reportBefore);
  });

  it('exits 1 with no CSV when nothing is pinned', async () => {
    const h = createHarness();
    expect(await h.run('replay', '1.2')).toBe(1);
    expect(h.io.stderrText()).toContain('no counterexample is pinned for 1.2');
    expect(h.fs.text(h.path('.golem/replays/1.2.csv'))).toBeUndefined();
    expect(h.spies.runTraced).toBe(0);
  });

  it('uses the closest scenario of the report with --seed when nothing is pinned', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    await h.run('test', '--budget', '10');
    h.clearOutput();
    expect(await h.run('replay', '1.1', '--seed', '7')).toBe(0);
    expect(h.io.stdoutText()).toContain('seed 7');
    expect(h.io.stdoutText()).toContain('closest scenario');
  });

  it('exits 1 naming the id and the cause when the trace is unavailable, and writes no CSV', async () => {
    const h = createHarness({ traceError: new TraceUnavailableError() });
    await h.run('falsify', '1.2', '--budget', '24');
    h.clearOutput();
    expect(await h.run('replay', '1.2')).toBe(1);
    expect(h.io.stderrText()).toContain('replay of 1.2 failed');
    expect(h.io.stderrText()).toContain('golem-sim');
    expect(h.fs.text(h.path('.golem/replays/1.2.csv'))).toBeUndefined();
  });

  it('lists the valid ids for an unknown id', async () => {
    const h = createHarness();
    expect(await h.run('replay', 'R9')).toBe(1);
    expect(h.io.stderrText()).toContain('valid ids');
  });
});

describe('golem gate', () => {
  it('exits 2 and prints a block per requirement that is not held', async () => {
    const h = createHarness();
    expect(await h.run('gate')).toBe(2);
    const out = h.io.stdoutText();
    expect(out).toContain('1.2: WHEN the base is pushed with up to 200 N');
    expect(out).toMatch(/scenario: push\.force = [\d.]+ N \(seed \d+\)/);
    expect(out).toMatch(/margin: -[\d.]+ m/);
    expect(out).toContain('reproduce: golem replay 1.2');
    expect(out).toContain('gate RED: 1 of 3 requirements are not held');
    expect(h.report().meta.lastGateExitCode).toBe(2);
  });

  it('exits 0 and states the total trial count when every requirement holds', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await h.run('gate')).toBe(0);
    expect(h.io.stdoutText()).toMatch(/^no counterexample found in \d+ trials \(3 requirements/);
    expect(h.io.stdoutText()).toContain('in ' + String(h.report().verdicts.reduce((n: number, v: { trials: number }) => n + v.trials, 0)) + ' trials');
    expect(h.report().meta).toMatchObject({ lastGateExitCode: 0, budget: { maxTrials: 24 } });
  });

  it('exits 2 for an error verdict', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS, trial: () => { throw new Error('boom'); } });
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stdoutText()).toContain('error: boom');
  });

  it('runs pinned seeds first and counts the quick budget in addition to them', async () => {
    const h = createHarness();
    await h.run('falsify', '1.2', '--budget', '24');
    h.spies.poolSpecs.length = 0;
    const pinnedSeed = JSON.parse(h.fs.text(h.path('.golem/seeds/tiny/1.2.json')) as string)[0].seed;
    await h.run('gate');
    const first12 = h.spies.poolSpecs.find((s) => s.reqId === '1.2');
    expect(first12?.seed).toBe(pinnedSeed);
  });

  it('makes a requirement broken when a pinned seed no longer passes', async () => {
    const h = createHarness({ requirements: GREEN_REQUIREMENTS });
    const entry = { reqId: '1.1', scenario: { 'push.force': 100 }, seed: 5, robustness: -0.1, shrunk: true, foundAfter: 1 };
    h.fs.put(h.path('.golem/seeds/tiny/1.1.json'), `${JSON.stringify([entry])}\n`);
    expect(await h.run('gate', '--budget', '8')).toBe(0);
    h.fs.put(h.path('.golem/seeds/tiny/1.1.json'), `${JSON.stringify([{ ...entry, scenario: { 'push.force': 100 } }])}\n`);
    // a controller that now fails the pinned scenario
    const h2 = createHarness({ requirements: GREEN_REQUIREMENTS, trial: (req, spec) => ({ spec, robustness: spec.seed === 5 ? 0 : 0.2, worstAt: 0, unit: 'm', wallMs: 0 }) });
    h2.fs.put(h2.path('.golem/seeds/tiny/1.1.json'), `${JSON.stringify([entry])}\n`);
    expect(await h2.run('gate', '--budget', '8')).toBe(2);
    expect(h2.io.stdoutText()).toContain('1.1: ');
  });

  it('exits 2 and says there is nothing to check for an empty requirements list', async () => {
    const h = createHarness({ seed: false });
    h.fs.put(h.path('golem.config.json'), '{"app":"./a.js","requirements":[]}');
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stderrText()).toContain('nothing to check');
    expect(h.spies.createPool).toBe(0);
  });

  it('exits 1 for a compile error and runs no trial', async () => {
    const h = createHarness({ requirements: '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n' });
    expect(await h.run('gate')).toBe(1);
    expect(h.spies.createPool).toBe(0);
  });
});
