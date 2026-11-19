import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload } from '../../../test/support/harness.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { gateExitCode } from '../exit.js';
import { expectationMiss, meetsExpectation, mergeExpectations, parseExpectations } from '../expectation.js';

const table = (rows: string[]): string => `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n`;
/** Tiny requirements 1.1 and 1.3 hold, 1.2 breaks (200 N). */
const withTable = (text: string, rows: string[]): string => text.replace('### Requirement 1', `${table(rows)}\n### Requirement 1`);

describe('parseExpectations', () => {
  it('reads Expected_Hold and Expected_Break rows by criterion id', () => {
    const r = parseExpectations(table(['| 1.1 | Push | Expected_Hold |', '| 1.2 | Push | Expected_Break |']));
    expect([...r.byId]).toEqual([['1.1', 'Expected_Hold'], ['1.2', 'Expected_Break']]);
    expect(r.problems).toEqual([]);
  });

  it('returns nothing for a file without a table and ignores other tables', () => {
    expect(parseExpectations('# Requirements\n\n| Term | Meaning |\n|---|---|\n| a | b |\n').byId.size).toBe(0);
  });

  it('finds the columns by header name, whatever their order', () => {
    const r = parseExpectations('| Expectation | Criterion |\n|---|---|\n| Expected_Break | R2 |\n');
    expect(r.byId.get('R2')).toBe('Expected_Break');
  });

  it('reports an unreadable value and treats the line as absent', () => {
    const r = parseExpectations(table(['| 1.1 | Push | Expected_Brek |']));
    expect(r.byId.has('1.1')).toBe(false);
    expect(r.problems[0]).toContain('Expected_Brek');
  });

  it('uses the first row of an id that appears twice and says so', () => {
    const r = parseExpectations(table(['| 1.1 | A | Expected_Break |', '| 1.1 | B | Expected_Hold |']));
    expect(r.byId.get('1.1')).toBe('Expected_Break');
    expect(r.problems).toHaveLength(1);
  });

  it('merges files, first file wins', () => {
    const a = parseExpectations(table(['| 1.1 | A | Expected_Break |']));
    const b = parseExpectations(table(['| 1.1 | A | Expected_Hold |', '| 2.1 | A | Expected_Break |']));
    expect([...mergeExpectations([a, b]).byId]).toEqual([['1.1', 'Expected_Break'], ['2.1', 'Expected_Break']]);
  });

  it('round-trips generated tables', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }), fc.boolean()), { maxLength: 12 }),
      (rows) => {
        const want = new Map<string, 'Expected_Hold' | 'Expected_Break'>();
        for (const [a, b, br] of rows) if (!want.has(`${a}.${b}`)) want.set(`${a}.${b}`, br ? 'Expected_Break' : 'Expected_Hold');
        const text = table(rows.map(([a, b, br]) => `| ${a}.${b} | Topic | ${br ? 'Expected_Break' : 'Expected_Hold'} |`));
        expect(parseExpectations(text).byId).toEqual(want);
      },
    ));
  });
});

describe('meetsExpectation and the exit code', () => {
  it('Expected_Hold needs held, Expected_Break needs broken, an error meets neither', () => {
    expect(meetsExpectation('held', 'Expected_Hold')).toBe(true);
    expect(meetsExpectation('broken', 'Expected_Hold')).toBe(false);
    expect(meetsExpectation('broken', 'Expected_Break')).toBe(true);
    expect(meetsExpectation('held', 'Expected_Break')).toBe(false);
    expect(meetsExpectation('error', 'Expected_Hold')).toBe(false);
    expect(meetsExpectation('error', 'Expected_Break')).toBe(false);
  });

  it('says "expected to break but held within budget N" for a held Expected_Break line', () => {
    expect(expectationMiss('held', 'Expected_Break', 24)).toBe('expected to break but held within budget 24 trials');
    expect(expectationMiss('broken', 'Expected_Break', 24)).toBe('');
  });

  it('exits 0 only when every line meets its expectation (property)', () => {
    const line = fc.record({ status: fc.constantFrom('held' as const, 'broken' as const, 'error' as const), expectation: fc.constantFrom('Expected_Hold' as const, 'Expected_Break' as const) });
    fc.assert(fc.property(fc.array(line, { minLength: 1, maxLength: 10 }), (vs) => {
      const ok = vs.every((v) => (v.expectation === 'Expected_Break' ? v.status === 'broken' : v.status === 'held'));
      expect(gateExitCode(vs, false)).toBe(ok ? 0 : 2);
    }));
  });

  it('keeps treating a verdict without an expectation as Expected_Hold', () => {
    expect(gateExitCode([{ status: 'held' }], false)).toBe(0);
    expect(gateExitCode([{ status: 'broken' }], false)).toBe(2);
  });
});

describe('golem gate with an Expectation table', () => {
  const marked = withTable(RED_REQUIREMENTS, ['| 1.1 | Height | Expected_Hold |', '| 1.2 | Height | Expected_Break |', '| 1.3 | Tilt | Expected_Hold |']);

  it('is green when the line that is meant to break breaks, and prints both groups', async () => {
    const h = createHarness({ requirements: marked });
    expect(await h.run('gate')).toBe(0);
    const out = h.io.stdoutText();
    expect(out).toContain('Expected_Hold (2 lines: must hold)');
    expect(out).toContain('Expected_Break (1 line: must break)');
    expect(out).toMatch(/ok {4}1\.1 {2}HELD/);
    expect(out).toMatch(/ok {4}1\.2 {2}BROKEN/);
    expect(out).toContain('gate GREEN: every requirement meets its expectation (2 held as expected, 1 broke as expected');
    expect(h.report().meta.lastGateExitCode).toBe(0);
  });

  it('is red when an Expected_Break line holds, naming the budget', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.2 | Height | Expected_Break |']) });
    expect(await h.run('gate')).toBe(2);
    const out = h.io.stdoutText();
    expect(out).toMatch(/FAIL {2}1\.2 {2}HELD.*<- expected to break but held within budget \d+ trials/);
    expect(out).toContain('1.2: WHEN the base is pushed with up to 100 N');
    expect(out).toContain('gate RED: 1 of 3 requirements do not meet their expectation');
  });

  it('is red when an Expected_Hold line breaks, with the counterexample block', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.2 | Height | Expected_Hold |', '| 1.1 | Height | Expected_Break |']) });
    expect(await h.run('gate')).toBe(2);
    const out = h.io.stdoutText();
    expect(out).toContain('reproduce: npx golem-spec replay 1.2');
    expect(out).toContain('gate RED: 2 of 3 requirements do not meet their expectation');
  });

  it('keeps the plain output and Expected_Hold for every line when there is no table', async () => {
    const h = createHarness();
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stdoutText()).not.toContain('Expected_');
  });

  it('puts the expectation of each line in --json', async () => {
    const h = createHarness({ requirements: marked });
    expect(await h.run('gate', '--json')).toBe(0);
    const j = JSON.parse(h.io.stdoutText());
    expect(j.ok).toBe(true);
    expect(j.expectations).toEqual([
      { reqId: '1.1', expectation: 'Expected_Hold', status: 'held', met: true },
      { reqId: '1.2', expectation: 'Expected_Break', status: 'broken', met: true },
      { reqId: '1.3', expectation: 'Expected_Hold', status: 'held', met: true },
    ]);
  });
});

describe('golem gate --kiro with an Expectation table', () => {
  const stop = async (h: ReturnType<typeof createHarness>): Promise<{ code: number; stdout: string; stderr: string }> => {
    h.clock.advance(3000);
    h.clearOutput();
    h.io.setStdin(stopPayload('s1'));
    const code = await h.run('gate', '--kiro', '--budget', '12');
    return { code, stdout: h.io.stdoutText(), stderr: h.io.stderrText() };
  };

  it('lets the stop through when the Expected_Break line breaks', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.2 | Height | Expected_Break |']) });
    const r = await stop(h);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('gate GREEN: every requirement meets its expectation (2 Expected_Hold held, 1 Expected_Break broke');
  });

  it('blocks with the held-but-expected-to-break reason', async () => {
    const h = createHarness({ requirements: withTable(GREEN_REQUIREMENTS, ['| 1.2 | Height | Expected_Break |']) });
    const r = await stop(h);
    const j = JSON.parse(r.stdout);
    expect(j.decision).toBe('block');
    expect(j.reason).toContain('1.2: WHEN the base is pushed with up to 100 N');
    expect(j.reason).toMatch(/expected to break but held within budget \d+ trials/);
  });
});

describe('golem test and the MCP tools report the expectation', () => {
  const marked = withTable(RED_REQUIREMENTS, ['| 1.1 | Height | Expected_Hold |', '| 1.2 | Height | Expected_Break |', '| 1.3 | Tilt | Expected_Break |']);

  it('golem test prints the tag next to each verdict that has a row', async () => {
    const h = createHarness({ requirements: marked });
    await h.run('test', '--budget', '24');
    const lines = h.io.stdoutText().split('\n');
    expect(lines[0]).toMatch(/^1\.1 {2}HELD.*\[Expected_Hold: met\]$/);
    expect(lines[1]).toMatch(/^1\.2 {2}BROKEN.*\[Expected_Break: met\]$/);
    expect(lines[2]).toMatch(/^1\.3 {2}HELD.*\[Expected_Break: NOT met\]$/);
  });

  it('falsify and list_requirements carry the expectation', async () => {
    const m = await createMcpHarness({ requirements: marked });
    const r = await m.call('falsify', { reqId: '1.2', budget: 24 });
    expect(r.json).toMatchObject({ status: 'broken', expectation: 'Expected_Break', meetsExpectation: true });
    expect(r.summary).toMatch(/^1\.2 broken \[Expected_Break: met\]: margin/);
    const held = await m.call('falsify', { reqId: '1.3', budget: 8 });
    expect(held.json).toMatchObject({ status: 'held', expectation: 'Expected_Break', meetsExpectation: false });
    expect(held.summary).toMatch(/^1\.3 held \[Expected_Break: NOT met\]: .*; expected to break but held within budget \d+ trials$/);
    const list = await m.call('list_requirements');
    expect(list.json.requirements.map((x: { expectation: string }) => x.expectation)).toEqual(['Expected_Hold', 'Expected_Break', 'Expected_Break']);
  });
});
