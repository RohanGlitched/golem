// golem-gate-hardening task 6 (defects 4 and 5): a remedy the agent may take, and an override that says what it overrode.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload, type Harness } from '../../../test/support/harness.js';
import { TINY_IDS, arbMark, tableText, type Mark } from '../../../test/support/table-gen.js';
import { overrideIds } from '../gate-counter.js';

const withTable = (text: string, rows: string[]): string =>
  text.replace('### Requirement 1', `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n\n### Requirement 1`);
/** 1.2 holds (100 N) but is marked Expected_Break: a stale mark. */
const STALE = withTable(GREEN_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']);

async function stop(h: Harness): Promise<{ stdout: string; stderr: string }> {
  h.clock.advance(3000);
  h.clearOutput();
  h.io.setStdin(stopPayload('s1'));
  await h.run('gate', '--kiro', '--budget', '12');
  return { stdout: h.io.stdoutText(), stderr: h.io.stderrText() };
}

describe('the block of an Expected_Break line that held (defect 4)', () => {
  it('tells the agent to ask the user, not to edit the spec, with the same text under --kiro and without', async () => {
    const h = createHarness({ requirements: STALE });
    const reason = (JSON.parse((await stop(h)).stdout) as { reason: string }).reason;
    const want = 'This line held, so the controller is better than the spec expects. Look further with npx golem-spec falsify 1.2 --budget 200. '
      + 'If it still holds, tell the user to move row 1.2 of the Expectation table to Expected_Hold. Do not edit requirements.md yourself.';
    expect(reason).toContain(want);
    expect(reason).toMatch(/expected to break but held within budget \d+ trials/);
    expect(reason).not.toContain('or move this line to Expected_Hold');
    const plain = createHarness({ requirements: STALE });
    expect(await plain.run('gate')).toBe(2);
    expect(plain.io.stdoutText()).toContain(want);
    expect(plain.io.stdoutText()).not.toContain('or move this line to Expected_Hold');
  });

  it('stays red for a stale mark, with and without --kiro', async () => {
    const h = createHarness({ requirements: STALE });
    expect(await h.run('gate')).toBe(2);
    const k = createHarness({ requirements: STALE });
    for (let i = 0; i < 5; i++) expect(JSON.parse((await stop(k)).stdout).decision).toBe('block');
  });

  it('gives the Expected_Hold block and the error block their usual text', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    const reason = (JSON.parse((await stop(h)).stdout) as { reason: string }).reason;
    expect(reason).toContain('reproduce: npx golem-spec replay 1.2');
    expect(reason).not.toContain('This line held');
  });
});

describe('the Gate_Override (defect 5)', () => {
  it('lists a stale Expected_Break line as unmet and not as broken, and says why on stderr', async () => {
    const h = createHarness({ requirements: STALE });
    for (let i = 0; i < 5; i++) await stop(h);
    const sixth = await stop(h);
    expect(sixth.stdout).toBe('');
    expect(sixth.stderr).toContain('1.2: WHEN the base is pushed with up to 100 N');
    expect(sixth.stderr).toMatch(/\(expected to break but held within budget \d+ trials\)/);
    const o = h.report().gateOverrides;
    expect(o).toEqual([{ sessionId: 's1', timestamp: expect.any(String), count: 5, unmetReqIds: ['1.2'], brokenReqIds: [] }]);
    expect(h.report().verdicts.find((v: { reqId: string }) => v.reqId === '1.2').status).toBe('held');
  });

  it('lists a broken Expected_Hold line in both', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    for (let i = 0; i < 6; i++) await stop(h);
    expect(h.report().gateOverrides[0]).toMatchObject({ unmetReqIds: ['1.2'], brokenReqIds: ['1.2'] });
  });

  it('lists the pseudo id of a gate that could not run in both', async () => {
    const bad = withTable(GREEN_REQUIREMENTS, ['| 1.20 | x | Expected_Break |']);
    const h = createHarness({ requirements: bad });
    for (let i = 0; i < 6; i++) await stop(h);
    expect(h.report().gateOverrides[0]).toMatchObject({ unmetReqIds: ['expectations'], brokenReqIds: ['expectations'] });
  });

  it('splits unmet ids: unmet is everything, broken is what is not held (property)', () => {
    const arbU = fc.array(fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }), status: fc.constantFrom('held' as const, 'broken' as const, 'error' as const) }), { maxLength: 10 });
    fc.assert(fc.property(arbU, (unmet) => {
      const r = overrideIds(unmet);
      expect(r.unmetReqIds).toEqual(unmet.map((u) => u.id));
      expect(r.brokenReqIds).toEqual(unmet.filter((u) => u.status !== 'held').map((u) => u.id));
      for (const id of r.brokenReqIds) expect(r.unmetReqIds).toContain(id);
      const heldIds = unmet.filter((u) => u.status === 'held').map((u) => u.id);
      for (const id of heldIds) if (!unmet.some((u) => u.id === id && u.status !== 'held')) expect(r.brokenReqIds).not.toContain(id);
    }), { numRuns: 200 });
  });

  it('records exactly the lines whose report entry has met false, after six stops, over random marks (property)', async () => {
    await fc.assert(fc.asyncProperty(fc.array(arbMark, { minLength: 3, maxLength: 3 }), async (marks) => {
      const rows = TINY_IDS.map((id, i) => [id, marks[i] as Mark] as const);
      const h = createHarness({ requirements: RED_REQUIREMENTS.replace('### Requirement 1', `${tableText(rows)}\n### Requirement 1`) });
      for (let i = 0; i < 6; i++) await stop(h);
      const rep = h.report();
      const unmet = rep.verdicts.filter((v: { met: boolean }) => !v.met).map((v: { reqId: string }) => v.reqId);
      if (unmet.length === 0) { expect(rep.gateOverrides).toEqual([]); return; }
      expect(rep.gateOverrides).toHaveLength(1);
      expect(rep.gateOverrides[0].unmetReqIds).toEqual(unmet);
      for (const id of rep.gateOverrides[0].brokenReqIds) expect(unmet).toContain(id);
      for (const v of rep.verdicts) if (v.status === 'held') expect(rep.gateOverrides[0].brokenReqIds).not.toContain(v.reqId);
    }), { numRuns: 100 });
  });
});
