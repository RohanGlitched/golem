import { describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { LoadError, RestartLimitError, TrialCrashError } from '../falsify/errors.js';
import type { HostMessage, WorkerMessage } from './protocol.js';
import { TrialScheduler } from './scheduler.js';
import type { WorkerFactory } from './worker-like.js';
import { essentials, pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('TrialScheduler crash recovery', () => {
  it('replaces a crashed worker in the same slot and retries the trial once with the same spec', async () => {
    const { pool, drain, f, dispatched } = rig({
      size: 1,
      script: { job: (j) => (j.spec.seed === 7 && j.generation === 0 ? { kind: 'crash', reason: 'segfault' } : undefined) },
    });
    const specs = [spec(7), spec(8)];
    const p = track(pool.run(specs));
    await drain();
    const results = p.value() as TrialResult[];
    expect(results.map(essentials)).toEqual(specs.map((s) => essentials(pureTrial(s) as TrialResult)));
    expect(results[0]?.spec).toBe(specs[0]);
    expect(f.workers.map((w) => [w.slot, w.generation])).toEqual([[0, 0], [0, 1]]);
    expect(f.workers[0]?.terminated).toBe(true);
    expect(dispatched().map((d) => [d.seed, d.generation])).toEqual([[7, 0], [7, 1], [8, 1]]);
    expect(pool.size).toBe(1);
    await pool.close();
  });

  it('puts the retry at the queue front', async () => {
    const { pool, drain, dispatched } = rig({
      size: 1,
      script: { job: (j) => (j.spec.seed === 2 && j.generation === 0 ? { kind: 'crash' } : undefined) },
    });
    const a = track(pool.run([spec(1), spec(2), spec(3)]));
    const b = track(pool.run([spec(4)]));
    await drain();
    expect(a.settled() && b.settled()).toBe(true);
    expect(dispatched().map((d) => d.seed)).toEqual([1, 2, 2, 3, 4]);
    await pool.close();
  });

  it('rejects only the run whose trial crashed two workers', async () => {
    const { pool, drain } = rig({
      size: 2,
      script: { job: (j) => (j.spec.seed === 99 ? { kind: 'crash', reason: 'oom' } : { kind: 'ok', delay: 5 }) },
    });
    const bad = track(pool.run([spec(99, { reqId: 'R2' }), spec(1)]));
    const good = track(pool.run([spec(2), spec(3), spec(4)]));
    await drain();
    const err = bad.error() as TrialCrashError;
    expect(err).toBeInstanceOf(TrialCrashError);
    expect(err.message).toMatch(/R2/);
    expect(err.message).toMatch(/seed 99/);
    expect(err.message).toMatch(/app a/);
    expect(err.message).toMatch(/crashed two workers/);
    expect((good.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual([2, 3, 4]);
    expect(pool.size).toBe(2);
    await pool.close();
  });

  it('fails with RestartLimitError naming the slot and last message, and close still resolves', async () => {
    const { pool, drain } = rig({
      size: 1, sched: { maxRestarts: 2 },
      script: { job: () => ({ kind: 'crash', reason: 'bad alloc' }) },
    });
    const runs = [track(pool.run([spec(1)])), track(pool.run([spec(2)])), track(pool.run([spec(3)]))];
    await drain();
    const err = runs[2]?.error() as RestartLimitError;
    expect(err).toBeInstanceOf(RestartLimitError);
    expect(err.message).toContain('slot 0');
    expect(err.message).toContain('bad alloc');
    await expect(pool.run([spec(4)])).rejects.toBeInstanceOf(RestartLimitError);
    await expect(pool.close()).resolves.toBeUndefined();
  });

  it('resets the restart count after a completed trial', async () => {
    // Every other trial crashes once; with maxRestarts 1 the pool survives because each success resets.
    const { pool, drain } = rig({
      size: 1, sched: { maxRestarts: 1 },
      script: { job: (j) => (j.spec.seed % 2 === 0 && j.generation % 2 === 0 ? { kind: 'crash' } : undefined) },
    });
    const specs = Array.from({ length: 8 }, (_, i) => spec(i));
    const p = track(pool.run(specs));
    await drain();
    expect((p.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual(specs.map((s) => s.seed));
    await pool.close();
  });

  it('counts a failed load of a crash replacement as a restart and retries', async () => {
    const { pool, drain, f } = rig({
      size: 1, sched: { maxRestarts: 5 },
      script: {
        job: (j) => (j.generation === 0 ? { kind: 'crash' } : undefined),
        loadFail: (_s, g) => (g === 1 || g === 2 ? 'transient load failure' : undefined),
      },
    });
    const p = track(pool.run([spec(1)]));
    await drain();
    expect((p.value() as TrialResult[])[0]?.spec.seed).toBe(1);
    expect(f.workers).toHaveLength(4);
    await pool.close();
  });

  it('fails the scheduler with LoadError when the first worker fails to load', async () => {
    const { pool, drain } = rig({ size: 2, script: { loadFail: (s) => (s === 0 ? 'mujoco.wasm missing' : undefined) } });
    const ready = track(pool.ready);
    const p = track(pool.run([spec(1)]));
    await drain();
    expect(ready.error()).toBeInstanceOf(LoadError);
    expect((ready.error() as Error).message).toContain('worker 0');
    expect((p.error() as Error).message).toContain('mujoco.wasm missing');
    await expect(pool.run([spec(2)])).rejects.toThrow('mujoco.wasm missing');
    await expect(pool.close()).resolves.toBeUndefined();
  });

  it('ignores messages from a terminated worker', async () => {
    // Hand-driven workers that keep their callbacks after terminate, so a stale message can be sent.
    const made: { post: HostMessage[]; msg?: (m: WorkerMessage) => void; crash?: (r: string) => void }[] = [];
    const factory: WorkerFactory = () => {
      const rec: (typeof made)[number] = { post: [] };
      made.push(rec);
      return {
        post: (m) => { rec.post.push(m); },
        onMessage: (cb) => { rec.msg = cb; },
        onCrash: (cb) => { rec.crash = cb; },
        terminate: async () => undefined,
      };
    };
    const pool = new TrialScheduler({ size: 1, factory, appId: 'a', config: {} });
    made[0]?.msg?.({ type: 'ready', slot: 0 });
    const seen: number[] = [];
    const s1 = spec(1);
    const p = track(pool.run([s1], (r) => { seen.push(r.robustness); }));
    const run0 = made[0]?.post.find((m) => m.type === 'run') as { id: number };
    made[0]?.crash?.('exit code 134');
    expect(made).toHaveLength(2);
    // Stale result from the dead worker: ignored.
    made[0]?.msg?.({ type: 'result', id: run0.id, result: { ...(pureTrial(s1) as TrialResult), robustness: -123 } });
    made[0]?.msg?.({ type: 'ready', slot: 0 });
    expect(seen).toEqual([]);
    made[1]?.msg?.({ type: 'ready', slot: 0 });
    const run1 = made[1]?.post.find((m) => m.type === 'run') as { id: number };
    expect(run1.id).not.toBe(run0.id);
    made[1]?.msg?.({ type: 'result', id: run1.id, result: pureTrial(s1) as TrialResult });
    await Promise.resolve();
    expect(seen).toEqual([(pureTrial(s1) as TrialResult).robustness]);
    expect(p.settled()).toBe(true);
    await pool.close();
  });
});
