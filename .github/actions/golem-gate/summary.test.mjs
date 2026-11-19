import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSummary, cell, formatMargin, formatScenario, main, reproduceCommand, sig3 } from './summary.mjs';

const verdict = (reqId, status, extra = {}) => ({
  reqId, status, trials: 24, randomTrials: 4, guidedTrials: 20,
  closest: { robustness: 0.25, scenario: { 'push.force': 40 }, seed: 1 }, ms: 10, ...extra,
});
const broken = (reqId, robustness, scenario) => verdict(reqId, 'broken', {
  closest: { robustness, scenario, seed: 7 },
  counterexample: { reqId, scenario, seed: 9, robustness, shrunk: true, foundAfter: 3 },
});
const exp = (reqId, expectation, status, met) => ({ reqId, expectation, status, met });

const gateRed = {
  ok: false, exitCode: 2,
  verdicts: [verdict('1.1', 'held'), broken('1.3', -0.439, { 'push.angle': Math.PI / 2, 'push.force': 72.1, 'push.phase': 0.277 })],
  expectations: [exp('1.1', 'Expected_Hold', 'held', true), exp('1.3', 'Expected_Hold', 'broken', false)],
};
const report = {
  verdicts: [
    { reqId: '1.1', unit: 'm', ears: 'WHEN pushed THE robot SHALL stay upright' },
    { reqId: '1.3', unit: 'm', ears: 'WHEN pushed harder THE robot SHALL stay upright' },
  ],
};
const rowsOf = (md) => md.split('\n').filter((l) => /^\| \*\*/.test(l));

describe('buildSummary', () => {
  it('has one row per requirement, with expectation, verdict, margin, counterexample and reproduce command', () => {
    const md = buildSummary({ gate: gateRed, report, exitCode: 2, appDir: 'apps/stagger', budget: 24 });
    expect(md).toContain('## GOLEM gate (`apps/stagger`): RED (exit 2)');
    expect(md).toContain('1 of 2 requirements do not meet their expectation: 1.3.');
    const rows = rowsOf(md);
    expect(rows).toHaveLength(2);
    const r13 = rows[1];
    expect(r13).toContain('Expected_Hold');
    expect(r13).toContain('| broken | **NO** | -0.439 m |');
    expect(r13).toContain('push.angle = 90 deg, push.force = 72.1 N, push.phase = 0.277 of the stride (shrunk, seed 9)');
    expect(r13).toContain('`cd apps/stagger && npx --no-install golem-spec replay 1.3`');
    expect(rows[0]).toContain('| held | yes | closest +0.25 m | none found in 24 trials |');
    expect(rows[0]).toContain('`cd apps/stagger && npx --no-install golem-spec falsify 1.1 --budget 24`');
  });

  it('says GREEN and has no failing row when every line meets its expectation', () => {
    const gate = { ok: true, exitCode: 0, verdicts: [verdict('1.1', 'held')], expectations: [exp('1.1', 'Expected_Hold', 'held', true)] };
    const md = buildSummary({ gate, report, exitCode: 0, budget: 24 });
    expect(md).toContain('## GOLEM gate: GREEN (exit 0)');
    expect(md).toContain('Every requirement meets its expectation: 1 of 1.');
    expect(md).not.toContain('**NO**');
    expect(md).toContain('`npx --no-install golem-spec falsify 1.1 --budget 24`');
  });

  it('names the environment and the search seed so that the reproduce command matches the run', () => {
    const md = buildSummary({ gate: gateRed, report, exitCode: 2, budget: 24, searchSeed: 7, env: { GOLEM_REFLEX: 'kiro', PATH: '/bin', GOLEM_: 'x' } });
    expect(md).toContain('Search seed: 7.');
    expect(md).toContain('Environment: `GOLEM_REFLEX=kiro`.');
    expect(md).toContain('`GOLEM_REFLEX=kiro npx --no-install golem-spec replay 1.3`');
    expect(md).toContain('`GOLEM_REFLEX=kiro npx --no-install golem-spec falsify 1.1 --budget 24 --search-seed 7`');
    expect(md).not.toContain('PATH');
  });

  it('asks for a deeper search when an Expected_Break line held', () => {
    const gate = { ok: false, exitCode: 2, verdicts: [verdict('4.2', 'held')], expectations: [exp('4.2', 'Expected_Break', 'held', false)] };
    const md = buildSummary({ gate, report: null, exitCode: 2, budget: 24 });
    expect(rowsOf(md)[0]).toContain('| Expected_Break | held | **NO** |');
    expect(rowsOf(md)[0]).toContain('falsify 4.2 --budget 200');
  });

  it('marks an errored line without inventing a margin', () => {
    const gate = { ok: false, exitCode: 2, verdicts: [verdict('1.1', 'error')], expectations: [exp('1.1', 'Expected_Hold', 'error', false)] };
    const row = rowsOf(buildSummary({ gate, report, exitCode: 2, budget: 24 }))[0];
    expect(row).toContain('| error | **NO** | - | the run ended in an error; see the job log |');
  });

  it('reports a gate that printed nothing, with the tail of its output', () => {
    const stderrTail = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const md = buildSummary({ gate: null, report: null, exitCode: 1, stderrTail });
    expect(md).toContain('could not run (exit 1)');
    expect(md).toContain('line 59');
    expect(md).not.toContain('line 19\n');
    expect(md).toContain('line 20');
    expect(rowsOf(md)).toHaveLength(0);
  });

  it('keeps one table row per requirement whatever the ids and text contain', () => {
    const text = fc.string({ unit: fc.constantFrom('a', ' ', '|', '<', '>', '&', '`', '\n', '*', '1', '.'), maxLength: 30 });
    fc.assert(fc.property(
      fc.array(fc.record({ id: text, ears: text, met: fc.boolean(), status: fc.constantFrom('held', 'broken', 'error') }), { minLength: 1, maxLength: 8 }),
      (reqs) => {
        const ids = reqs.map((r, i) => `${i}${r.id}`);
        const gate = {
          ok: false, exitCode: 2,
          verdicts: reqs.map((r, i) => (r.status === 'broken' ? broken(ids[i], -1, { 'push.force': 5 }) : verdict(ids[i], r.status))),
          expectations: reqs.map((r, i) => exp(ids[i], 'Expected_Hold', r.status, r.met)),
        };
        const rep = { verdicts: reqs.map((r, i) => ({ reqId: ids[i], unit: 'm', ears: r.ears })) };
        const md = buildSummary({ gate, report: rep, exitCode: 2, budget: 24 });
        const lines = md.split('\n');
        const start = lines.findIndex((l) => l.startsWith('| Requirement'));
        const table = [];
        for (let i = start; i < lines.length && lines[i].startsWith('|'); i++) table.push(lines[i]);
        // header, separator and one line per requirement; a cell never contains a raw newline or an unescaped pipe
        expect(table).toHaveLength(2 + reqs.length);
        for (const row of table) expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(9);
      },
    ), { numRuns: 200 });
  });
});

describe('formatting helpers', () => {
  it('prints margins with a sign and a unit', () => {
    expect(formatMargin(-0.3182571, 'm')).toBe('-0.318 m');
    expect(formatMargin(0.2520825, 'm')).toBe('+0.252 m');
    expect(formatMargin(0.1, undefined)).toBe('+0.1 unit not declared');
    expect(formatMargin(Number.NaN, 'm')).toBe('margin unavailable');
    expect(formatMargin(-Infinity, 'm')).toBe('-infinity m');
  });

  it('keeps three significant digits', () => {
    expect(sig3(215.70333626)).toBe('216');
    expect(sig3(0.0714923)).toBe('0.0715');
    expect(sig3(-0)).toBe('0');
  });

  it('turns SI scenario values into the units the lines are written in', () => {
    expect(formatScenario({ 'push.force': 215.7, 'push.angle': 3.8326647 })).toBe('push.force = 216 N, push.angle = 220 deg');
    expect(formatScenario({ 'payload.mass': 15, 'latency.duration': 0.05, 'other.thing': 1.23456 })).toBe('payload.mass = 15 kg, latency.duration = 0.05 s, other.thing = 1.23');
    expect(formatScenario({})).toBe('no varied dimension');
  });

  it('never lets a cell break the table', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const c = cell(s);
      expect(c).not.toMatch(/[\r\n|<>]/);
    }));
  });

  it('replays a broken line and re-searches a held one', () => {
    const base = { appDir: '.', budget: 24, searchSeed: undefined, env: {} };
    expect(reproduceCommand({ reqId: '1.3', status: 'broken', met: false, expectation: 'Expected_Hold' }, base)).toBe('npx --no-install golem-spec replay 1.3');
    expect(reproduceCommand({ reqId: '1.1', status: 'held', met: true, expectation: 'Expected_Hold' }, base)).toBe('npx --no-install golem-spec falsify 1.1 --budget 24');
  });
});

describe('main', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'golem-summary-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('appends the summary to the output file and exits 0 even when the gate exit code is 2', () => {
    const gateFile = join(dir, 'gate.json');
    const reportFile = join(dir, 'report.json');
    const out = join(dir, 'summary.md');
    writeFileSync(out, 'earlier step\n');
    writeFileSync(gateFile, `${JSON.stringify(gateRed)}\n`);
    writeFileSync(reportFile, JSON.stringify(report));
    const code = main(['--gate', gateFile, '--report', reportFile, '--exit-code', '2', '--app-dir', '.', '--budget', '24', '--out', out], {});
    expect(code).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text.startsWith('earlier step\n')).toBe(true);
    expect(text).toContain('RED (exit 2)');
  });

  it('reads the summary path from GITHUB_STEP_SUMMARY and survives missing files', () => {
    const out = join(dir, 'step.md');
    const code = main(['--gate', join(dir, 'nope.json'), '--report', join(dir, 'nope2.json'), '--exit-code', '1'], { GITHUB_STEP_SUMMARY: out });
    expect(code).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('could not run (exit 1)');
  });

  it('finds the JSON on the last line when the gate wrote other lines first', () => {
    const gateFile = join(dir, 'gate.json');
    const out = join(dir, 'summary.md');
    writeFileSync(gateFile, `a log line\n${JSON.stringify(gateRed)}\n`);
    main(['--gate', gateFile, '--exit-code', '2', '--out', out], {});
    expect(readFileSync(out, 'utf8')).toContain('RED (exit 2)');
  });
});
