// golem-gate-hardening task 4 (defects 1 and 2): a table error stops the gate and reaches whoever reads the output.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload, type Harness } from '../../../test/support/harness.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { arbMark, arbRows, arbKnownId, arbUnknownId, tableText } from '../../../test/support/table-gen.js';

const table = (rows: string[]): string => `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n`;
const withTable = (text: string, rows: string[]): string => text.replace('### Requirement 1', `${table(rows)}\n### Requirement 1`);
const H = 'Expected_Hold';
const B = 'Expected_Break';
const full = (m1: string, m2: string, m3: string): string[] => [`| 1.1 | x | ${m1} |`, `| 1.2 | x | ${m2} |`, `| 1.3 | x | ${m3} |`];

async function stop(h: Harness, session = 's1'): Promise<{ code: number; stdout: string; stderr: string }> {
  h.clock.advance(3000);
  h.clearOutput();
  h.io.setStdin(stopPayload(session));
  const code = await h.run('gate', '--kiro', '--budget', '12');
  return { code, stdout: h.io.stdoutText(), stderr: h.io.stderrText() };
}
const reasonOf = (r: { stdout: string }): string => (JSON.parse(r.stdout) as { reason: string }).reason;

describe('golem gate with a table error', () => {
  it('exits 1 for an orphan row, names the row and its nearest id, and runs no trial', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, full(H, B, H).concat(['| 1.20 | x | Expected_Break |'])) });
    expect(await h.run('gate')).toBe(1);
    expect(h.io.stderrText()).toContain('requirements.md:');
    expect(h.io.stderrText()).toMatch(/error: the table marks 1\.20, but no requirement has that id \(did you mean 1\.2\?\)/);
    expect(h.io.stderrText()).toContain('the Expectation table has 1 error(s); run npx golem-spec check');
    expect(h.spies.createPool).toBe(0);
    expect(h.io.stdoutText()).toBe('');
  });

  it('exits 1 for an unreadable mark instead of guessing Expected_Hold', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, full(H, 'Expected_Brek', H)) });
    expect(await h.run('gate')).toBe(1);
    expect(h.io.stderrText()).toContain('the expectation of 1.2 is "Expected_Brek"');
    expect(h.spies.createPool).toBe(0);
  });

  it('prints an unmarked line as a warning and still runs', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`, `| 1.2 | x | ${B} |`]) });
    expect(await h.run('gate')).toBe(0);
    expect(h.io.stderrText()).toMatch(/warning: 1\.3 has no row in the Expectation table, so it is Expected_Hold/);
  });

  it('exits 1 for an orphan row with --json and prints nothing on stdout', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| R1.2 | x | Expected_Break |']) });
    expect(await h.run('gate', '--json')).toBe(1);
    expect(h.io.stdoutText()).toBe('');
  });

  it('keeps a compile error ahead of a table error', async () => {
    const bad = withTable(RED_REQUIREMENTS, ['| 9.9 | x | Expected_Break |']).replace('keep its height above 0.4 m for 1 s\n2.', 'keep its heigth above 0.4 m for 1 s\n2.');
    const h = createHarness({ requirements: bad });
    expect(await h.run('gate')).toBe(1);
    expect(h.io.stderrText()).toContain('the requirements do not compile');
    expect(h.io.stderrText()).not.toContain('the Expectation table has');
  });
});

describe('golem gate --kiro with a table error', () => {
  it('blocks with the diagnostic in the Stop reason (typo on a line that breaks)', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, full(H, 'Expected_Brek', H)) });
    const r = await stop(h);
    expect(r.code).toBe(0);
    const reason = reasonOf(r);
    expect(reason).toContain('The Expectation table has 1 error(s), so the gate cannot run.');
    expect(reason).toContain('If you may not edit requirements.md, tell the user. Do not change a mark to make the gate pass.');
    expect(reason).toContain('the expectation of 1.2 is "Expected_Brek"; use Expected_Hold or Expected_Break');
    expect(h.spies.createPool).toBe(0);
    expect(JSON.parse(h.fs.text(h.path('.golem/gate-state.json')) as string).s1.count).toBe(1);
  });

  it('blocks with the orphan row and its suggestion (R1.2)', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| R1.2 | x | Expected_Break |']) });
    const reason = reasonOf(await stop(h));
    expect(reason).toContain('the table marks R1.2, but no requirement has that id (did you mean 1.2?)');
  });

  it('counts table errors toward the five blocks and records the override with the id expectations', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    for (let i = 0; i < 5; i++) expect(JSON.parse((await stop(h)).stdout).decision).toBe('block');
    const sixth = await stop(h);
    expect(sixth.stdout).toBe('');
    expect(sixth.stderr).toContain('expectations: the Expectation table has 1 error(s)');
    expect(h.report().gateOverrides[0].brokenReqIds).toEqual(['expectations']);
  });

  it('puts the unmarked-line notes after the counterexample blocks when the gate is red for another reason', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`]) });
    const reason = reasonOf(await stop(h));
    expect(reason).toContain('1.2: WHEN the base is pushed with up to 200 N');
    expect(reason.indexOf('Expectation table notes:')).toBeGreaterThan(reason.indexOf('reproduce: npx golem-spec replay 1.2'));
    expect(reason).toContain('1.3 has no row in the Expectation table, so it is Expected_Hold');
  });

  it('does not mention the table when it has no issue', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, full(H, H, H)) });
    expect(reasonOf(await stop(h))).not.toContain('Expectation table');
  });

  it('logs a warning of the table on stderr when the gate is green, and lets the stop through', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, [`| 1.1 | x | ${H} |`]) });
    const r = await stop(h);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/warning: 1\.2 has no row in the Expectation table, so it is Expected_Hold/);
    expect(r.stderr).toMatch(/warning: 1\.3 has no row/);
  });

  it('writes the issues to stderr as well (the log)', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    expect((await stop(h)).stderr).toContain('error: the table marks 1.20');
  });

  it('keeps the table error, not a counterexample, when the table is wrong and the line breaks', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    expect(reasonOf(await stop(h))).not.toContain('reproduce: npx golem-spec replay');
  });
});

describe('golem check, test and MCP list read the table', () => {
  it('check prints table issues like diagnostics and exits 1 on an error', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |', `| 1.1 | x | ${H} |`]) });
    expect(await h.run('check')).toBe(1);
    const out = h.io.stdoutText();
    expect(out).toMatch(/requirements\.md:\d+:1: error: the table marks 1\.20, but no requirement has that id \(did you mean 1\.2\?\)/);
    expect(out).toMatch(/requirements\.md:\d+:1: warning: 1\.2 has no row in the Expectation table/);
    expect(out).toContain('3 requirements compiled, 2 warnings, 1 errors');
  });

  it('check --json carries the table issues and ok false for an error', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    expect(await h.run('check', '--json')).toBe(1);
    const j = JSON.parse(h.io.stdoutText());
    expect(j.ok).toBe(false);
    expect(j.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toHaveLength(1);
    expect(j.diagnostics[0]).toMatchObject({ col: 1, suggestion: null });
  });

  it('check exits 0 with only warnings, and prints nothing about a table when there is none', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, [`| 1.1 | x | ${H} |`]) });
    expect(await h.run('check')).toBe(0);
    expect(h.io.stdoutText()).toContain('2 warnings');
    const none = createHarness({ requirements: GREEN_REQUIREMENTS });
    expect(await none.run('check')).toBe(0);
    expect(none.io.stdoutText()).toBe('3 requirements compiled, 0 warnings\n');
  });

  it('check on one file does not report orphans or unmarked lines', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |', 'oops']) });
    expect(await h.run('check', '.kiro/specs/tiny/requirements.md')).toBe(0);
  });

  it('check reports a bad mark although the lines do not compile', async () => {
    const bad = withTable(GREEN_REQUIREMENTS, ['| 1.1 | x | Expected_Brek |']).replace('keep its height above 0.4 m for 1 s\n2.', 'keep its heigth above 0.4 m for 1 s\n2.');
    const h = createHarness({ requirements: bad });
    expect(await h.run('check')).toBe(1);
    expect(h.io.stdoutText()).toContain('the expectation of 1.1 is "Expected_Brek"');
  });

  it('test prints every issue as a warning and keeps its exit code', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    expect(await h.run('test', '--budget', '8')).toBe(0);
    expect(h.io.stderrText()).toContain('error: the table marks 1.20, but no requirement has that id');
    expect(h.io.stderrText()).toContain('golem test: the Expectation table has 1 error(s)');
  });

  it('MCP list_requirements adds expectationIssues only when there are some', async () => {
    const m = await createMcpHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']) });
    const r = await m.call('list_requirements');
    expect(r.json.expectationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', message: expect.stringContaining('the table marks 1.20') })]));
    expect(r.summary).toContain('expectation table');
    const clean = await createMcpHarness({ requirements: GREEN_REQUIREMENTS });
    expect((await clean.call('list_requirements')).json.expectationIssues).toBeUndefined();
  });
});

describe('properties of the gate over random tables', () => {
  it('an orphan row never turns exit 2 into 0, always exits 1 naming the id, and runs no trial (property)', async () => {
    await fc.assert(fc.asyncProperty(arbRows(arbKnownId), arbUnknownId, arbMark, async (rows, unknown, mark) => {
      const base = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows)}\n### Requirement 1`) });
      const without = await base.run('gate', '--budget', '6');
      const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText([...rows, [unknown, mark]])}\n### Requirement 1`) });
      const code = await h.run('gate', '--budget', '6');
      expect(code).toBe(1);
      expect(without === 0 && code === 0).toBe(false);
      expect(h.io.stderrText()).toContain(`the table marks ${unknown}, but no requirement has that id`);
      expect(h.spies.createPool).toBe(0);
    }), { numRuns: 100 });
  });

  it('--kiro prints nothing or one JSON line that blocks, with a reason of at most 4000 characters, and exits 0 (property)', async () => {
    const arbAnyId = fc.oneof(arbKnownId, arbUnknownId);
    await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.tuple(arbAnyId, fc.oneof(arbMark, fc.constant('Expected_Brek' as never))), { selector: (r) => r[0], maxLength: 6 }), async (rows) => {
      const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows as never)}\n### Requirement 1`) });
      const r = await stop(h);
      expect(r.code).toBe(0);
      if (r.stdout !== '') {
        expect(r.stdout.endsWith('\n')).toBe(true);
        const lines = r.stdout.trimEnd().split('\n');
        expect(lines).toHaveLength(1);
        const j = JSON.parse(lines[0] as string);
        expect(j.decision).toBe('block');
        expect(typeof j.reason).toBe('string');
        expect(j.reason.length).toBeGreaterThan(0);
        expect(j.reason.length).toBeLessThanOrEqual(4000);
      }
    }), { numRuns: 100 });
  });
});
