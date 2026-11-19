// golem-gate-hardening task 5 (defect 3): the report records the marks, and a mark that moved is shown.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload, type Harness } from '../../../test/support/harness.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { APP_DIR } from '../../../test/support/test-deps.js';
import { TINY_IDS, arbMark, arbRows, arbKnownId, tableText, type Mark } from '../../../test/support/table-gen.js';
import { diffExpectations, readExpectations } from '../expectation.js';

const REQ = `${APP_DIR}/.kiro/specs/tiny/requirements.md`;
const table = (rows: string[]): string => `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n`;
const withTable = (text: string, rows: string[]): string => text.replace('### Requirement 1', `${table(rows)}\n### Requirement 1`);
const CHANGE = '1.2: Expected_Hold -> Expected_Break (uncommitted)';

async function stop(h: Harness): Promise<{ code: number; stdout: string; stderr: string }> {
  h.clock.advance(3000);
  h.clearOutput();
  h.io.setStdin(stopPayload('s1'));
  const code = await h.run('gate', '--kiro', '--budget', '12');
  return { code, stdout: h.io.stdoutText(), stderr: h.io.stderrText() };
}

describe('one row turns a red gate green, and the move is shown (probe 2 B5, probe 3 section 3)', () => {
  const flipped = withTable(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']);

  it('exits 2 without the row and 0 with it, and the second run says which mark moved', async () => {
    const red = createHarness({ requirements: RED_REQUIREMENTS, committed: { [REQ]: RED_REQUIREMENTS } });
    expect(await red.run('gate')).toBe(2);
    expect(red.io.stdoutText()).not.toContain('uncommitted');
    const green = createHarness({ requirements: flipped, committed: { [REQ]: RED_REQUIREMENTS } });
    expect(await green.run('gate')).toBe(0);
    expect(green.io.stdoutText()).toContain(CHANGE);
    expect(green.io.stdoutText().indexOf(CHANGE)).toBeLessThan(green.io.stdoutText().indexOf('gate GREEN'));
  });

  it('records the expectation and met of every line, and the change, in report.json', async () => {
    const h = createHarness({ requirements: flipped, committed: { [REQ]: RED_REQUIREMENTS } });
    await h.run('gate');
    const r = h.report();
    expect(r.verdicts.map((v: { reqId: string; status: string; expectation: string; met: boolean }) => [v.reqId, v.status, v.expectation, v.met])).toEqual([
      ['1.1', 'held', 'Expected_Hold', true], ['1.2', 'broken', 'Expected_Break', true], ['1.3', 'held', 'Expected_Hold', true],
    ]);
    expect(r.meta.lastGateExitCode).toBe(0);
    expect(r.meta.expectationChanges).toEqual([{ id: '1.2', from: 'Expected_Hold', to: 'Expected_Break' }]);
  });

  it('omits expectationChanges from the report when no mark moved', async () => {
    const h = createHarness({ requirements: flipped, committed: { [REQ]: flipped } });
    expect(await h.run('gate')).toBe(0);
    expect(h.report().meta).not.toHaveProperty('expectationChanges');
    expect(h.io.stdoutText()).not.toContain('uncommitted');
  });

  it('shows no change when the deps cannot read the committed file, or it fails, or the file is not committed', async () => {
    for (const o of [{}, { readCommitted: async () => { throw new Error('git is not installed'); } }, { readCommitted: async () => undefined }]) {
      const h = createHarness({ requirements: flipped, ...o });
      expect(await h.run('gate')).toBe(0);
      expect(h.io.stdoutText()).not.toContain('uncommitted');
      expect(h.report().meta).not.toHaveProperty('expectationChanges');
    }
  });

  it('lists a removed Expected_Break row as a change back to Expected_Hold', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS, committed: { [REQ]: flipped } });
    await h.run('gate');
    expect(h.io.stdoutText()).toContain('1.2: Expected_Break -> Expected_Hold (uncommitted)');
  });

  it('carries expectationChanges in --json, an empty array when none', async () => {
    const a = createHarness({ requirements: flipped, committed: { [REQ]: RED_REQUIREMENTS } });
    await a.run('gate', '--json');
    expect(JSON.parse(a.io.stdoutText()).expectationChanges).toEqual([{ id: '1.2', from: 'Expected_Hold', to: 'Expected_Break' }]);
    const b = createHarness({ requirements: flipped, committed: { [REQ]: flipped } });
    await b.run('gate', '--json');
    expect(JSON.parse(b.io.stdoutText()).expectationChanges).toEqual([]);
  });
});

describe('gate --kiro shows the move to the agent', () => {
  it('starts the Stop reason with the change when the gate blocks', async () => {
    const stale = withTable(GREEN_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']);
    const h = createHarness({ requirements: stale, committed: { [REQ]: GREEN_REQUIREMENTS } });
    const reason = (JSON.parse((await stop(h)).stdout) as { reason: string }).reason;
    expect(reason.startsWith(`Expectation marks changed since the last commit (a changed mark is a spec change, not a fix):\n  ${CHANGE}\n\n1.2: `)).toBe(true);
  });

  it('keeps the table error block ahead of nothing but the change block', async () => {
    const bad = withTable(GREEN_REQUIREMENTS, ['| 1.2 | x | Expected_Break |', '| 1.20 | x | Expected_Break |']);
    const h = createHarness({ requirements: bad, committed: { [REQ]: GREEN_REQUIREMENTS } });
    const reason = (JSON.parse((await stop(h)).stdout) as { reason: string }).reason;
    expect(reason.indexOf('Expectation marks changed')).toBe(0);
    expect(reason.indexOf('The Expectation table has 1 error(s)')).toBeGreaterThan(0);
  });

  it('only logs the change when the stop is allowed, and does not change the decision', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']), committed: { [REQ]: RED_REQUIREMENTS } });
    const r = await stop(h);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(CHANGE);
    expect(h.report().meta.expectationChanges).toHaveLength(1);
  });

  it('adds nothing to the reason when no mark moved', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS, committed: { [REQ]: RED_REQUIREMENTS } });
    expect((JSON.parse((await stop(h)).stdout) as { reason: string }).reason).not.toContain('Expectation marks changed');
  });
});

describe('every writer of the report records the expectation', () => {
  const marked = withTable(RED_REQUIREMENTS, ['| 1.1 | x | Expected_Hold |', '| 1.2 | x | Expected_Break |', '| 1.3 | x | Expected_Break |']);

  it('golem test writes expectation and met, the default included', async () => {
    const h = createHarness({ requirements: withTable(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']) });
    await h.run('test', '--budget', '24');
    expect(h.report().verdicts.map((v: { expectation: string; met: boolean }) => [v.expectation, v.met])).toEqual([
      ['Expected_Hold', true], ['Expected_Break', true], ['Expected_Hold', true],
    ]);
  });

  it('golem falsify writes them for its one line', async () => {
    const h = createHarness({ requirements: marked });
    await h.run('falsify', '1.3', '--budget', '8');
    expect(h.report().verdicts[0]).toMatchObject({ reqId: '1.3', status: 'held', expectation: 'Expected_Break', met: false });
  });

  it('the MCP falsify tool writes them', async () => {
    const m = await createMcpHarness({ requirements: marked });
    await m.call('falsify', { reqId: '1.2', budget: 24 });
    const rep = JSON.parse(m.fs.text(`${APP_DIR}/.golem/report.json`) as string);
    expect(rep.verdicts.find((v: { reqId: string }) => v.reqId === '1.2')).toMatchObject({ expectation: 'Expected_Break', met: true });
  });
});

describe('properties', () => {
  const idOrder = (rows: readonly (readonly [string, Mark])[]): string[] => rows.map(([id]) => id);

  it('diffExpectations lists exactly the ids whose effective expectation differs, each once, after-rows first (property)', () => {
    fc.assert(fc.property(arbRows(arbKnownId), arbRows(arbKnownId), (a, b) => {
      const before = readExpectations({ f: tableText(a) }, ['f'], { reconcile: false });
      const after = readExpectations({ f: tableText(b) }, ['f'], { reconcile: false });
      const eff = (rows: readonly (readonly [string, Mark])[], id: string): Mark => rows.find(([x]) => x === id)?.[1] ?? 'Expected_Hold';
      const changes = diffExpectations(before, after);
      const want = [...new Set([...idOrder(b), ...idOrder(a)])].filter((id) => eff(a, id) !== eff(b, id));
      expect(changes.map((c) => c.id)).toEqual(want);
      for (const c of changes) expect([c.from, c.to]).toEqual([eff(a, c.id), eff(b, c.id)]);
      expect(diffExpectations(before, before)).toEqual([]);
    }), { numRuns: 200 });
  });

  it('flipping one row flips met of that line and of no other line (property)', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...TINY_IDS), fc.array(arbMark, { minLength: 3, maxLength: 3 }), async (flipId, marks) => {
      const run = async (m: readonly Mark[]): Promise<Record<string, { status: string; met: boolean }>> => {
        const rows = TINY_IDS.map((id, i) => [id, m[i] as Mark] as const);
        const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows)}\n### Requirement 1`) });
        await h.run('gate', '--budget', '24');
        return Object.fromEntries(h.report().verdicts.map((v: { reqId: string; status: string; met: boolean }) => [v.reqId, v]));
      };
      const flipped = marks.map((m, i) => (TINY_IDS[i] === flipId ? (m === 'Expected_Hold' ? 'Expected_Break' : 'Expected_Hold') : m)) as Mark[];
      const a = await run(marks);
      const b = await run(flipped);
      for (const id of TINY_IDS) {
        expect(['held', 'broken']).toContain(a[id]?.status);
        expect(b[id]?.status).toBe(a[id]?.status);
        expect(b[id]?.met).toBe(id === flipId ? !a[id]?.met : a[id]?.met);
      }
    }), { numRuns: 100 });
  });
});
