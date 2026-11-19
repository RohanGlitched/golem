// golem-gate-hardening task 2 (defect 9): the Expectation table is read once, from the text that was compiled.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness } from '../../../test/support/harness.js';
import { arbRows, arbKnownId, arbStyle, expectedById, tableText } from '../../../test/support/table-gen.js';
import { tinyTrial } from '../../../test/support/tiny-app.js';
import { readExpectations } from '../expectation.js';
import { bootstrap, compileAll, loadExpectations } from '../service.js';

const MARK_1_2 = '\n| Criterion | Topic | Expectation |\n|---|---|---|\n| 1.2 | Height | Expected_Break |\n';
const withMark = (text: string): string => text.replace('### Requirement 1', `${MARK_1_2}\n### Requirement 1`);

describe('the table is read from the text that was compiled (defect 9)', () => {
  it('uses the marks of the file as it was compiled when the file changes during the run', async () => {
    const path = '/proj/app/.kiro/specs/tiny/requirements.md';
    let rewritten = false;
    const h = createHarness({
      requirements: withMark(RED_REQUIREMENTS),
      trial: (req, spec) => {
        if (!rewritten) { rewritten = true; h.fs.put(path, RED_REQUIREMENTS); }
        return tinyTrial(req, spec).result;
      },
    });
    // 1.2 breaks and is marked Expected_Break in the version that was compiled: green. The rewritten file has no mark.
    expect(await h.run('gate')).toBe(0);
    expect(rewritten).toBe(true);
    expect(h.io.stdoutText()).toContain('gate GREEN');
  });

  it('rethrows a read error other than a missing file', async () => {
    const h = createHarness({ requirements: withMark(RED_REQUIREMENTS) });
    const boot = await bootstrap('/proj/app', undefined, h.deps);
    const denied = { ...h.deps.fs, readFile: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } };
    await expect(loadExpectations(boot.app, { fs: denied })).rejects.toThrow('EACCES');
  });

  it('treats a missing file as no table', async () => {
    const h = createHarness({ requirements: withMark(RED_REQUIREMENTS) });
    const boot = await bootstrap('/proj/app', undefined, h.deps);
    const gone = { ...h.deps.fs, readFile: async () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }); } };
    const t = await loadExpectations(boot.app, { fs: gone });
    expect(t.byId.size).toBe(0);
    expect(t.problems).toEqual([]);
  });

  it('returns the text of every file it compiled', async () => {
    const h = createHarness({ requirements: withMark(RED_REQUIREMENTS) });
    const boot = await bootstrap('/proj/app', undefined, h.deps);
    const c = await compileAll(boot.app, boot.robotApp, h.deps);
    expect(Object.keys(c.texts)).toEqual(c.files);
    expect(c.texts[c.files[0] as string]).toBe(withMark(RED_REQUIREMENTS));
  });

  it('gives the same table from compileAll texts as from parsing the file text, for any table and spelling (property)', async () => {
    await fc.assert(fc.asyncProperty(arbRows(arbKnownId), arbStyle, fc.boolean(), async (rows, style, before) => {
      const table = tableText(rows, style);
      const text = before
        ? GREEN_REQUIREMENTS.replace('### Requirement 1', `${table}\n### Requirement 1`)
        : `${GREEN_REQUIREMENTS}\n## Notes\n\n${table}`;
      const h = createHarness({ requirements: text });
      const boot = await bootstrap('/proj/app', undefined, h.deps);
      const c = await compileAll(boot.app, boot.robotApp, h.deps);
      expect(c.texts[c.files[0] as string]).toBe(text);
      expect(readExpectations(c.texts, c.files).byId).toEqual(expectedById(rows));
    }), { numRuns: 100 });
  });
});
