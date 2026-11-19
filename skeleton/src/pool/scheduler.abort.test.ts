import { describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { AbortError, LoadError } from '../falsify/errors.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory } from './testing.js';
import { essentials, pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('TrialScheduler cancellation', () => {
  it('rejects an already-aborted run without dispatching anything', async () => {
    const { pool, drain, dispatched } = rig({ size: 2 });
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(pool.run([spec(1)], () => { calls++; }, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await drain();
    expect(dispatched()).toHaveLength(0);
    expect(calls).toBe(0);
    await pool.close();
  });

  it('rejects in the same turn as the abort, drops queued specs and ignores late results', async () => {
    const { pool, drain, dispatched, timers } = rig({ size: 2, script: { job: () => ({ kind: 'ok', delay: 100 }) } });
    await drain();
    const ac = new AbortController();
    let calls = 0;
    const p = track(pool.run(Array.from({ length: 6 }, (_, i) => spec(i)), () => { calls++; }, { signal: ac.signal }));
    await timers.advance(0);
    expect(dispatched()).toHaveLength(2);
    ac.abort();
    await Promise.resolve();
    expect(p.error()).toBeInstanceOf(AbortError);
    await drain();
    expect(calls).toBe(0);
    expect(dispatched()).toHaveLength(2);
    await pool.close();
  });

  it('keeps a run queued behind the aborted one in order and resolves it', async () => {
    const { pool, drain, dispatched, timers } = rig({ size: 1, script: { job: () => ({ kind: 'ok', delay: 10 }) } });
    await drain();
    const ac = new AbortController();
    const a = track(pool.run([spec(1), spec(2), spec(3)], undefined, { signal: ac.signal }));
    const b = track(pool.run([spec(10), spec(11)]));
    await timers.advance(0);
    ac.abort();
    await drain();
    expect(a.error()).toBeInstanceOf(AbortError);
    expect((b.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual([10, 11]);
    expect(dispatched().map((d) => d.seed)).toEqual([1, 10, 11]);
    await pool.close();
  });

  it('returns the slot to idle when the late result beats the grace timer', async () => {
    const { pool, drain, f, timers } = rig({ size: 1, sched: { abortGraceMs: 500 }, script: { job: () => ({ kind: 'ok', delay: 300 }) } });
    await drain();
    const ac = new AbortController();
    const p = track(pool.run([spec(1)], undefined, { signal: ac.signal }));
    await timers.advance(0);
    ac.abort();
    await timers.advance(300);
    expect(p.error()).toBeInstanceOf(AbortError);
    expect(f.workers).toHaveLength(1);
    expect(f.workers[0]?.received.some((m) => m.type === 'cancel')).toBe(true);
    const q = track(pool.run([spec(2)]));
    await drain();
    expect((q.value() as TrialResult[])[0]?.spec.seed).toBe(2);
    expect(f.workers).toHaveLength(1);
    await pool.close();
  });

  it('replaces a stuck worker when the grace timer fires, without counting a restart', async () => {
    const { pool, drain, f, timers } = rig({
      size: 1, sched: { abortGraceMs: 200, maxRestarts: 0 },
      script: { job: (j) => (j.generation === 0 ? { kind: 'hang' } : undefined) },
    });
    await drain();
    const ac = new AbortController();
    const p = track(pool.run([spec(1)], undefined, { signal: ac.signal }));
    await timers.advance(0);
    ac.abort();
    await timers.advance(199);
    expect(f.workers).toHaveLength(1);
    await timers.advance(1);
    expect(p.error()).toBeInstanceOf(AbortError);
    expect(f.workers).toHaveLength(2);
    expect(f.workers[0]?.terminated).toBe(true);
    expect(pool.size).toBe(1);
    const q = track(pool.run([spec(5)]));
    await drain();
    expect((q.value() as TrialResult[]).map(essentials)).toEqual([essentials(pureTrial(spec(5)) as TrialResult)]);
    expect(f.alive()).toBe(1);
    await pool.close();
  });

  it('fails later runs with the load message when an abort replacement fails to load', async () => {
    const { pool, drain, timers } = rig({
      size: 1, sched: { abortGraceMs: 100 },
      script: {
        job: (j) => (j.generation === 0 ? { kind: 'hang' } : undefined),
        loadFail: (_s, g) => (g === 1 ? 'mujoco.wasm: 404' : undefined),
      },
    });
    await drain();
    const ac = new AbortController();
    const p = track(pool.run([spec(1)], undefined, { signal: ac.signal }));
    await timers.advance(0);
    ac.abort();
    await drain();
    expect(p.error()).toBeInstanceOf(AbortError);
    const err = await pool.run([spec(2)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect((err as Error).message).toContain('mujoco.wasm: 404');
    await expect(pool.close()).resolves.toBeUndefined();
  });

  it('rejects abortGraceMs outside 100..60000 ms', () => {
    const f = fakeWorkerFactory({ trialFn: pureTrial });
    for (const abortGraceMs of [99, 60001, Number.NaN]) {
      expect(() => new TrialScheduler({ size: 1, abortGraceMs, factory: f.factory, appId: 'a', config: {} })).toThrow(/abortGraceMs.*got/);
    }
    expect(() => new TrialScheduler({ size: 1, abortGraceMs: 100, factory: f.factory, appId: 'a', config: {} })).not.toThrow();
  });
});
