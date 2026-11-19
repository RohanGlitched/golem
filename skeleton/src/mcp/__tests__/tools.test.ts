import { describe, expect, it } from 'vitest';
import { TraceUnavailableError } from '../../cli/deps.js';
import { parseEntries } from '../proposals.js';
import { GREEN_REQUIREMENTS } from '../../../test/support/harness.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';

describe('list_requirements', () => {
  it('lists ids, EARS lines and statuses in file order, unknown without a report', async () => {
    const m = await createMcpHarness();
    const r = await m.call('list_requirements');
    expect(r.json.requirements.map((x: { id: string }) => x.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(r.json.requirements.every((x: { status: string }) => x.status === 'unknown')).toBe(true);
    await m.call('falsify', { reqId: '1.2' });
    const after = await m.call('list_requirements');
    expect(after.json.requirements.find((x: { id: string }) => x.id === '1.2').status).toBe('broken');
    expect(after.json.requirements[0].source).toContain('WHEN the base is pushed');
    expect(after.summary).toContain('1 broken');
  });

  it('gives every status unknown with a note for an unreadable report and leaves the file untouched', async () => {
    const m = await createMcpHarness();
    m.fs.put(m.path('.golem/report.json'), '{ nope');
    const r = await m.call('list_requirements');
    expect(r.json.requirements.every((x: { status: string }) => x.status === 'unknown')).toBe(true);
    expect(r.json.note).toContain('unreadable');
    expect(m.fs.text(m.path('.golem/report.json'))).toBe('{ nope');
  });
});

describe('check_requirement', () => {
  it('returns the scenario space of a compiling line with units, writing nothing and running nothing', async () => {
    const m = await createMcpHarness();
    const before = m.fs.log.length;
    const r = await m.call('check_requirement', { text: 'WHEN the base is pushed with up to 120 N THE robot SHALL keep its height above 0.4 m for 1 s' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ ok: true, pattern: 'event', space: { dims: [{ name: 'push.force', kind: 'force', min: 0, max: 120 }] } });
    expect(r.summary).toContain('push.force from 0 N to 120 N');
    expect(m.fs.log.length).toBe(before);
    expect(m.spies).toMatchObject({ createPool: 0, poolRun: 0, runTraced: 0 });
  });

  it('returns Diagnostics with suggestions as a success for text that does not compile', async () => {
    const m = await createMcpHarness();
    const r = await m.call('check_requirement', { text: 'WHEN the base is pushed with up to 120 N THE robot SHALL keep its heigth above 0.4 m for 1 s' });
    expect(r.isError).toBe(false);
    expect(r.json.ok).toBe(false);
    expect(r.json.diagnostics[0]).toMatchObject({ severity: 'error', line: 1 });
    expect(r.json.diagnostics[0].suggestion).toContain('keep its height above');
    expect(r.summary).toContain('does not compile');
  });
});

describe('run_requirement and falsify', () => {
  it('falsify pins a shrunk counterexample and updates the report before returning', async () => {
    const m = await createMcpHarness();
    const r = await m.call('falsify', { reqId: '1.2', budget: 24 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ reqId: '1.2', status: 'broken', counterexample: { shrunk: true, unit: 'm' }, pinned: 'added' });
    expect(r.summary).toMatch(/^1\.2 broken: margin -[\d.]+ m at push\.force = [\d.]+ N \(seed \d+\), \d+ trials, shrunk; reproduce: golem replay 1\.2$/);
    expect(JSON.parse(m.fs.text(m.path('.golem/seeds/tiny/1.2.json')) as string)).toHaveLength(1);
    expect(m.report().verdicts.find((v: { reqId: string }) => v.reqId === '1.2').status).toBe('broken');
  });

  it('run_requirement uses random trials only and defaults to a budget of 24', async () => {
    const m = await createMcpHarness({ requirements: GREEN_REQUIREMENTS });
    const r = await m.call('run_requirement', { reqId: '1.1' });
    expect(r.json).toMatchObject({ status: 'held', guidedTrials: 0 });
    expect(r.summary).toContain('no counterexample found in');
    expect(m.report().meta.budget).toEqual({ maxTrials: 24 });
  });

  it('names an unknown id with the valid ids and runs no trial', async () => {
    const m = await createMcpHarness();
    const r = await m.call('falsify', { reqId: 'zz' });
    expect(r).toMatchObject({ isError: true, json: { validIds: ['1.1', '1.2', '1.3'] } });
    expect(m.spies.createPool).toBe(0);
  });

  it('runs calls one at a time in arrival order on one shared pool', async () => {
    const m = await createMcpHarness({ requirements: GREEN_REQUIREMENTS });
    const rs = await Promise.all([m.call('run_requirement', { reqId: '1.1', budget: 4 }), m.call('run_requirement', { reqId: '1.2', budget: 4 }), m.call('run_requirement', { reqId: '1.3', budget: 4 })]);
    expect(rs.map((r) => r.json.reqId)).toEqual(['1.1', '1.2', '1.3']);
    expect(m.spies.createPool).toBe(1);
    const order = m.spies.poolSpecs.map((s) => s.reqId);
    expect([...new Set(order)]).toEqual(['1.1', '1.2', '1.3']);
  });
});

describe('get_counterexample', () => {
  it('returns null with a plain statement when nothing is pinned, then the latest pinned entry', async () => {
    const m = await createMcpHarness();
    const none = await m.call('get_counterexample', { reqId: '1.2' });
    expect(none.json.counterexample).toBeNull();
    expect(none.summary).toBe('no counterexample is pinned for 1.2');
    await m.call('falsify', { reqId: '1.2' });
    const got = await m.call('get_counterexample', { reqId: '1.2' });
    expect(got.json.counterexample).toMatchObject({ unit: 'm', shrunk: true });
    expect(got.summary).toMatch(/push\.force = [\d.]+ N \(seed \d+\), margin -[\d.]+ m/);
  });

  it('lists the valid ids for an unknown id', async () => {
    expect((await (await createMcpHarness()).call('get_counterexample', { reqId: 'x' })).summary).toContain('valid ids: 1.1, 1.2, 1.3');
  });
});

describe('replay', () => {
  it('gives identical results for equal scenario and seed and a 10 Hz summary with a studio url', async () => {
    const m = await createMcpHarness();
    await m.call('falsify', { reqId: '1.2' });
    const a = await m.call('replay', { reqId: '1.2' });
    const b = await m.call('replay', { reqId: '1.2' });
    expect(b.json).toEqual(a.json);
    expect(a.json.summary).toMatchObject({ intervalS: 0.1, truncated: false });
    expect(a.json.summary.samples).toHaveLength(11);
    expect(a.json.studioUrl).toMatch(/^apps\/tiny\/web\/index\.html#r=1\.2&seed=\d+/);
    expect(a.json.signals[0]).toMatchObject({ signal: 'height', unit: 'm' });
  });

  it('lists the pinned seeds for an unknown seed, runs nothing without a pinned counterexample', async () => {
    const m = await createMcpHarness();
    const none = await m.call('replay', { reqId: '1.2' });
    expect(none).toMatchObject({ isError: true });
    expect(m.spies.runTraced).toBe(0);
    await m.call('falsify', { reqId: '1.2' });
    const bad = await m.call('replay', { reqId: '1.2', seed: 4294967295 });
    expect(bad.isError).toBe(true);
    expect(bad.summary).toContain('is not pinned');
    expect(bad.json.pinnedSeeds).toHaveLength(1);
  });

  it('gives an error naming the cause when the trace is unavailable', async () => {
    const m = await createMcpHarness({ traceError: new TraceUnavailableError() });
    await m.call('falsify', { reqId: '1.2' });
    const r = await m.call('replay', { reqId: '1.2' });
    expect(r.isError).toBe(true);
    expect(r.summary).toContain('golem-sim');
  });
});

describe('explain_margin', () => {
  it('names the lowest-margin signal and the others from the predicate bindings when the monitor has no breakdown', async () => {
    const m = await createMcpHarness({ predicates: true, noMargins: true });
    await m.call('falsify', { reqId: '1.2' });
    const r = await m.call('explain_margin', { reqId: '1.2' });
    expect(r.isError).toBe(false);
    expect(r.json.lowest).toMatchObject({ signal: 'height', unit: 'm' });
    expect(r.json.lowest.margin).toBeLessThan(0);
    expect(r.json.others.map((o: { signal: string }) => o.signal)).toEqual(['tilt']);
    expect(r.json.marginSource).toBe('recomputed');
    expect(r.summary).toMatch(/lowest margin on height, -[\d.]+ m at t = [\d.]+ s \(pinned counterexample/);
  });

  it('uses the closest scenario of the last run when nothing is pinned, and says so', async () => {
    const m = await createMcpHarness({ predicates: true, requirements: GREEN_REQUIREMENTS });
    await m.call('run_requirement', { reqId: '1.1', budget: 6 });
    const r = await m.call('explain_margin', { reqId: '1.1' });
    expect(r.json.source).toBe('closest');
    expect(r.summary).toContain('closest scenario of the last run');
  });

  it('suggests falsify when there is neither a pinned counterexample nor a run', async () => {
    const m = await createMcpHarness({ predicates: true });
    const r = await m.call('explain_margin', { reqId: '1.2' });
    expect(r).toMatchObject({ isError: true });
    expect(r.summary).toContain('call falsify first');
  });

  it('uses the breakdown of the monitor when the compiled requirement provides one', async () => {
    const m = await createMcpHarness();
    await m.call('falsify', { reqId: '1.2' });
    const r = await m.call('explain_margin', { reqId: '1.2' });
    expect(r.isError).toBe(false);
    expect(r.json.marginSource).toBe('monitor');
    expect(r.json.lowest).toMatchObject({ signal: 'height', unit: 'm' });
    expect(r.json.lowest.margin).toBeCloseTo(r.json.robustness, 12);
    expect(r.json.lowest.at).toBeGreaterThan(0);
    expect(r.json.others).toEqual([]);
    expect(r.summary).toMatch(/\. The requirement itself has margin -[\d.]+ m at t = [\d.]+ s\.$/);
    expect(r.json.worstAt).toBeCloseTo(r.json.lowest.at, 12);
  });

  it('returns the unavailable-margins error when the monitor has no breakdown and the requirement has no predicate bindings', async () => {
    const m = await createMcpHarness({ noMargins: true });
    await m.call('falsify', { reqId: '1.2' });
    const r = await m.call('explain_margin', { reqId: '1.2' });
    expect(r.isError).toBe(true);
    expect(r.summary).toBe('per-signal margins unavailable: the compiled requirement carries no predicate bindings');
  });
});

describe('propose_requirement', () => {
  const GOOD = 'WHEN the base is pushed with up to 250 N THE robot SHALL keep its height above 0.4 m for 1 s';

  it('appends an accepted line and leaves every requirements file byte-identical', async () => {
    const m = await createMcpHarness();
    const req = m.fs.text(m.path('.kiro/specs/tiny/requirements.md'));
    const r = await m.call('propose_requirement', { text: GOOD, rationale: 'a crowd member can lean on the robot' });
    expect(r.json).toMatchObject({ recorded: true, file: '.kiro/specs/tiny/proposals.md', proposals: 1 });
    const entries = parseEntries(m.fs.text(m.path('.kiro/specs/tiny/proposals.md')) as string).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ text: GOOD, rationale: 'a crowd member can lean on the robot' });
    expect(m.fs.text(m.path('.kiro/specs/tiny/requirements.md'))).toBe(req);
  });

  it('does not record a line that does not compile', async () => {
    const m = await createMcpHarness();
    const r = await m.call('propose_requirement', { text: GOOD.replace('height', 'heigth') });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ recorded: false, reason: 'does not compile' });
    expect(m.fs.text(m.path('.kiro/specs/tiny/proposals.md'))).toBeUndefined();
  });

  it('names file and line of a duplicate of a requirement, ignoring whitespace, and of an earlier proposal', async () => {
    const m = await createMcpHarness();
    const dupOfReq = await m.call('propose_requirement', { text: '  WHEN the base is pushed with up to 100 N   THE robot SHALL keep its height above 0.4 m for 1 s' });
    expect(dupOfReq.json).toMatchObject({ recorded: false, reason: 'duplicate', duplicate: { file: '.kiro/specs/tiny/requirements.md', line: 7 } });
    await m.call('propose_requirement', { text: GOOD });
    const dup = await m.call('propose_requirement', { text: GOOD.replace('THE robot', ' THE   robot') });
    expect(dup.json).toMatchObject({ recorded: false, reason: 'duplicate', duplicate: { file: '.kiro/specs/tiny/proposals.md' } });
  });

  it('records two overlapping calls in arrival order', async () => {
    const m = await createMcpHarness();
    const a = GOOD;
    const b = GOOD.replace('250 N', '260 N');
    await Promise.all([m.call('propose_requirement', { text: a }), m.call('propose_requirement', { text: b })]);
    expect(parseEntries(m.fs.text(m.path('.kiro/specs/tiny/proposals.md')) as string).entries.map((e) => e.text)).toEqual([a, b]);
  });

  it('names path and cause when the write fails and leaves the old file', async () => {
    const m = await createMcpHarness();
    m.fs.put(m.path('.kiro/specs/tiny/proposals.md'), 'old\n');
    m.fs.failOn('rename', 'proposals.md', new Error('disk full'));
    const r = await m.call('propose_requirement', { text: GOOD });
    expect(r.isError).toBe(true);
    expect(r.summary).toContain('proposals.md');
    expect(r.summary).toContain('disk full');
    expect(m.fs.text(m.path('.kiro/specs/tiny/proposals.md'))).toBe('old\n');
  });
});
