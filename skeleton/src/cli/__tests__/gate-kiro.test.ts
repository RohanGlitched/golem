import { describe, expect, it } from 'vitest';
import { GREEN_REQUIREMENTS, createHarness, stopPayload, type Harness } from '../../../test/support/harness.js';

const state = (h: Harness): Record<string, { count: number; updatedAt: string }> => JSON.parse(h.fs.text(h.path('.golem/gate-state.json')) ?? '{}');

/** One `golem gate --kiro` call for a session, `gapMs` after the previous one. */
async function stop(h: Harness, session: string | undefined, gapMs = 3000, ...flags: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  h.clock.advance(gapMs);
  h.clearOutput();
  h.io.setStdin(session === undefined ? undefined : stopPayload(session));
  const code = await h.run('gate', '--kiro', '--budget', '12', ...flags);
  return { code, stdout: h.io.stdoutText(), stderr: h.io.stderrText() };
}

describe('golem gate --kiro', () => {
  it('blocks the first five red runs of a session with one parseable JSON line and exit 0', async () => {
    const h = createHarness();
    for (let i = 1; i <= 5; i++) {
      const r = await stop(h, 's1');
      expect(r.code).toBe(0);
      expect(r.stdout.endsWith('\n')).toBe(true);
      expect(r.stdout.trim().split('\n')).toHaveLength(1);
      const j = JSON.parse(r.stdout);
      expect(j.decision).toBe('block');
      expect(j.reason).toContain('1.2: WHEN the base is pushed with up to 200 N');
      expect(j.reason).toContain('reproduce: golem replay 1.2');
      expect(state(h)['s1']?.count).toBe(i);
    }
  });

  it('allows the sixth red stop with 0 bytes on stdout, a RED message, a Gate_Override and count 0, and blocks the seventh', async () => {
    const h = createHarness();
    for (let i = 0; i < 5; i++) await stop(h, 's1');
    const sixth = await stop(h, 's1');
    expect(sixth.code).toBe(0);
    expect(sixth.stdout).toBe('');
    expect(sixth.stderr).toContain('RED');
    expect(sixth.stderr).toContain('1.2: WHEN the base is pushed');
    expect(state(h)['s1']?.count).toBe(0);
    const rep = h.report();
    expect(rep.gateOverrides).toEqual([{ sessionId: 's1', timestamp: expect.any(String), count: 5, brokenReqIds: ['1.2'] }]);
    const seventh = await stop(h, 's1');
    expect(JSON.parse(seventh.stdout).decision).toBe('block');
    expect(h.report().gateOverrides).toHaveLength(1);
  });

  it('prints 0 bytes and deletes the key when the gate turns green', async () => {
    const h = createHarness();
    await stop(h, 's1');
    h.fs.put(h.path('.kiro/specs/tiny/requirements.md'), GREEN_REQUIREMENTS);
    const r = await stop(h, 's1');
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.stderr).toContain('no counterexample found in');
    expect(state(h)['s1']).toBeUndefined();
  });

  it('counts two sessions apart and uses default without a session_id', async () => {
    const h = createHarness();
    await stop(h, 'a'); await stop(h, 'b'); await stop(h, 'a'); await stop(h, undefined);
    expect(Object.fromEntries(Object.entries(state(h)).map(([k, v]) => [k, v.count]))).toEqual({ a: 2, b: 1, default: 1 });
  });

  it('treats an invalid state file as empty with a warning that names the path, and prunes old entries', async () => {
    const h = createHarness();
    h.fs.put(h.path('.golem/gate-state.json'), '{ broken');
    const r = await stop(h, 's1');
    expect(r.stderr).toContain('gate-state.json');
    expect(JSON.parse(r.stdout).decision).toBe('block');
    expect(state(h)['s1']?.count).toBe(1);
    h.fs.put(h.path('.golem/gate-state.json'), JSON.stringify({ old: { count: 4, updatedAt: '2020-01-01T00:00:00.000Z' }, s1: state(h)['s1'] }));
    await stop(h, 's1');
    expect(Object.keys(state(h))).toEqual(['s1']);
  });

  it('writes the state through a temp file and rename before it prints', async () => {
    const h = createHarness();
    await stop(h, 's1');
    expect(h.fs.log.some((l) => /^write .*gate-state\.json\.tmp-/.test(l))).toBe(true);
    expect(h.fs.log.some((l) => /^rename .*gate-state\.json\.tmp-.* .*gate-state\.json$/.test(l))).toBe(true);
  });

  it('keeps the decision when the state write fails and warns with the path', async () => {
    const h = createHarness();
    h.fs.failOn('rename', 'gate-state.json');
    const r = await stop(h, 's1');
    expect(JSON.parse(r.stdout).decision).toBe('block');
    expect(r.stderr).toContain('gate-state.json');
    expect(h.fs.list().some((p) => p.includes('.tmp-') && p.includes('gate-state'))).toBe(false);
  });

  it('advances the count once for two runs 0.5 s apart and twice for two runs 3 s apart', async () => {
    const h = createHarness();
    await stop(h, 's1');
    await stop(h, 's1', 500);
    expect(state(h)['s1']?.count).toBe(1);
    await stop(h, 's1', 3000);
    expect(state(h)['s1']?.count).toBe(2);
  });

  it('blocks on a compile error with the diagnostics and runs no trial', async () => {
    const h = createHarness({ requirements: '### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its heigth above 0.4 m for 1 s\n' });
    const r = await stop(h, 's1');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).reason).toMatch(/requirements\.md:5:\d+: error/);
    expect(h.spies.createPool).toBe(0);
    expect(state(h)['s1']?.count).toBe(1);
  });

  it('blocks when the gate has nothing to check', async () => {
    const h = createHarness({ seed: false });
    h.fs.put(h.path('golem.config.json'), '{"app":"./a.js","requirements":[]}');
    const r = await stop(h, 's1');
    expect(JSON.parse(r.stdout).reason).toContain('nothing to check');
  });

  it('blocks with the cause when the gate cannot run (the pool fails)', async () => {
    const h = createHarness({ poolError: new Error('no workers') });
    const r = await stop(h, 's1');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).reason).toContain('The gate could not run: no workers');
  });

  it('exits 1 with 0 bytes on stdout for a usage error and for a missing config, before the state is read', async () => {
    const h = createHarness({ seed: false });
    h.io.setStdin(stopPayload('s1'));
    expect(await h.run('gate', '--kiro', '--budget', '0')).toBe(1);
    expect(await h.run('gate', '--kiro')).toBe(1);
    expect(h.io.stdoutText()).toBe('');
    expect(h.io.stderrText()).toContain('golem');
    expect(h.fs.text(h.path('.golem/gate-state.json'))).toBeUndefined();
  });

  it('ignores a payload that is not valid JSON', async () => {
    const h = createHarness();
    h.io.setStdin('not json');
    await h.run('gate', '--kiro', '--budget', '8');
    expect(state(h)['default']?.count).toBe(1);
  });
});
