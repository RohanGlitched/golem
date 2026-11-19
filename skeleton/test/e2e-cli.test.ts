// End to end on the Tiny_Test_App, in-process: init, check, test, gate red, fix the synthetic controller, gate green, replay.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RED_REQUIREMENTS, createHarness, stopPayload } from './support/harness.js';
import { PACK_DIR, packFile, packJson } from './support/pack.js';

describe('CLI end to end', () => {
  it('walks the whole loop with the real pack, from init to a green gate and a replay', async () => {
    const controller = { droop: 0.004 };
    const h = createHarness({ seed: false, droop: () => controller.droop });
    // the real pack, installed into a memory project
    const manifest = packJson('manifest.json') as { files: { rel: string }[] };
    h.fs.put('/pack/manifest.json', packFile('manifest.json'));
    for (const f of manifest.files) h.fs.put(`/pack/${f.rel}`, readFileSync(`${PACK_DIR}${f.rel}`));

    // 1. init: exit 0 and the files of the pack, the guard included
    expect(await h.run('init')).toBe(0);
    expect(h.fs.text(h.path('.kiro/hooks/golem-guard-requirements.mjs'))).toBe(packFile('hooks/golem-guard-requirements.mjs'));
    expect(h.fs.text(h.path('golem.config.json'))).toContain('.kiro/specs/robot/requirements.md');
    h.fs.put(h.path('.kiro/specs/robot/requirements.md'), RED_REQUIREMENTS);

    // 2. check: exit 0
    h.clearOutput();
    expect(await h.run('check')).toBe(0);
    expect(h.io.stdoutText()).toContain('3 requirements compiled, 0 warnings');

    // 3. test: requirement 1.2 breaks, exit 2, a seed is pinned
    h.clearOutput();
    expect(await h.run('test', '--budget', '24')).toBe(2);
    expect(h.io.stdoutText()).toMatch(/1\.2  BROKEN  margin -[\d.]+ m/);
    const pinned = JSON.parse(h.fs.text(h.path('.golem/seeds/tiny/1.2.json')) as string) as { seed: number }[];
    expect(pinned).toHaveLength(1);

    // 4. gate (no --kiro) is red: exit 2, with the reproduction command
    h.clearOutput();
    expect(await h.run('gate')).toBe(2);
    expect(h.io.stdoutText()).toContain('reproduce: npx golem-spec replay 1.2');

    // 5. gate --kiro blocks with exit 0 while red, and follows the counter cycle with the dedupe window
    const stop = async (gapMs: number): Promise<{ code: number; out: string; err: string }> => {
      h.clock.advance(gapMs);
      h.clearOutput();
      h.io.setStdin(stopPayload('e2e'));
      const code = await h.run('gate', '--kiro', '--budget', '12');
      return { code, out: h.io.stdoutText(), err: h.io.stderrText() };
    };
    const state = (): number | undefined => (JSON.parse(h.fs.text(h.path('.golem/gate-state.json')) ?? '{}') as Record<string, { count: number }>)['e2e']?.count;
    expect((await stop(3000)).code).toBe(0);
    expect(state()).toBe(1);
    const dup = await stop(500);
    expect(JSON.parse(dup.out).decision).toBe('block');
    expect(state()).toBe(1);
    expect(JSON.parse((await stop(3000)).out).decision).toBe('block');
    expect(state()).toBe(2);

    // 6. fix the synthetic controller: a smaller droop per newton. The requirement file is not touched.
    const requirementsBefore = h.fs.text(h.path('.kiro/specs/robot/requirements.md'));
    controller.droop = 0.002;

    // 7. gate is green: exit 0, the pinned seed passes now
    h.clearOutput();
    expect(await h.run('gate')).toBe(0);
    expect(h.io.stdoutText()).toMatch(/^no counterexample in \d+ trials/);
    expect(h.report().meta.lastGateExitCode).toBe(0);

    // 8. gate --kiro prints 0 bytes and deletes the session key
    const green = await stop(3000);
    expect(green).toMatchObject({ code: 0, out: '' });
    expect(state()).toBeUndefined();

    // 9. replay: exit 0 whatever the robustness, with the CSV and the Studio_URL
    h.clearOutput();
    expect(await h.run('replay', '1.2')).toBe(0);
    expect(h.io.stdoutText()).toMatch(/studio: apps\/tiny\/web\/index\.html#r=1\.2&seed=\d+/);
    expect(h.io.stdoutText()).toMatch(/robustness \+[\d.]+ m/);
    expect(h.fs.text(h.path('.golem/replays/1.2.csv'))?.split('\n')[0]).toBe('t,height,tilt');
    expect(h.fs.text(h.path('.kiro/specs/robot/requirements.md'))).toBe(requirementsBefore);
  });

  it('exits with the codes 0, 0, 2, 2, 0, 0 for init, check, test, gate, gate after the fix and replay', async () => {
    const controller = { droop: 0.004 };
    const h = createHarness({ seed: false, droop: () => controller.droop });
    const manifest = packJson('manifest.json') as { files: { rel: string }[] };
    h.fs.put('/pack/manifest.json', packFile('manifest.json'));
    for (const f of manifest.files) h.fs.put(`/pack/${f.rel}`, readFileSync(`${PACK_DIR}${f.rel}`));
    const codes: number[] = [];
    codes.push(await h.run('init'));
    h.fs.put(h.path('.kiro/specs/robot/requirements.md'), RED_REQUIREMENTS);
    codes.push(await h.run('check'));
    codes.push(await h.run('test', '--budget', '24'));
    codes.push(await h.run('gate'));
    controller.droop = 0.002;
    codes.push(await h.run('gate'));
    codes.push(await h.run('replay', '1.2'));
    expect(codes).toEqual([0, 0, 2, 2, 0, 0]);
  });

  it('blocks five times, allows the sixth red stop once and blocks the seventh again, with the dedupe window between runs', async () => {
    const h = createHarness({ requirements: RED_REQUIREMENTS });
    const outcomes: string[] = [];
    for (let i = 0; i < 7; i++) {
      h.clock.advance(3000);
      h.clearOutput();
      h.io.setStdin(stopPayload('cycle'));
      await h.run('gate', '--kiro', '--budget', '8');
      outcomes.push(h.io.stdoutText() === '' ? 'allow' : 'block');
    }
    expect(outcomes).toEqual(['block', 'block', 'block', 'block', 'block', 'allow', 'block']);
  });
});
