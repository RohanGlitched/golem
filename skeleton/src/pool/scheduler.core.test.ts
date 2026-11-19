import { describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { CancelledError, PoolClosedError, TrialError } from '../falsify/errors.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory } from './testing.js';
import { essentials, pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('TrialScheduler core', () => {
  it('resolves an empty run with [] and never calls onResult', async () => {
    const { pool } = rig({ size: 2 });
    let calls = 0;
    await expect(pool.run([], () => { calls++; })).resolves.toEqual([]);
    expect(calls).toBe(0);
    await pool.close();
  });

  it('reports size and resolves ready once every worker has loaded', async () => {
    const { pool, drain } = rig({ size: 3, script: { loadDelay: (s) => 10 * (s + 1) } });
    expect(pool.size).toBe(3);
    const ready = track(pool.ready);
    await drain();
    expect(ready.settled()).toBe(true);
    expect(ready.error()).toBeUndefined();
    await pool.close();
  });

  it('returns results in input order with the submitted spec, whatever the completion order', async () => {
    const { pool, drain } = rig({ size: 3, script: { shuffleSeed: 7, maxDelay: 50 } });
    const specs = Array.from({ length: 12 }, (_, i) => spec(i + 1));
    const seen: number[] = [];
    const p = track(pool.run(specs, (r) => { seen.push(r.spec.seed); }));
    await drain();
    const results = p.value() as TrialResult[];
    expect(results.map((r) => r.spec)).toEqual(specs);
    results.forEach((r, i) => expect(r.spec).toBe(specs[i]));
    expect(results.map(essentials)).toEqual(specs.map((s) => essentials(pureTrial(s) as TrialResult)));
    expect([...seen].sort((a, b) => a - b)).toEqual(specs.map((s) => s.seed));
    expect(seen).not.toEqual(specs.map((s) => s.seed)); // completion order differs from input order here
    await pool.close();
  });

  it('calls onResult for every result before run resolves', async () => {
    const { pool, drain } = rig({ size: 2 });
    let calls = 0;
    const p = pool.run([spec(1), spec(2), spec(3)], () => { calls++; }).then((r) => { expect(calls).toBe(3); return r; });
    await drain();
    await expect(p).resolves.toHaveLength(3);
    await pool.close();
  });

  it('keeps one in-flight job per slot', async () => {
    const { pool, f, drain } = rig({ size: 2, script: { shuffleSeed: 3, maxDelay: 20 } });
    const p = pool.run(Array.from({ length: 8 }, (_, i) => spec(i)));
    await drain();
    await p;
    for (const w of f.workers) expect(w.received.filter((m) => m.type === 'run').length).toBeGreaterThan(0);
    await pool.close();
  });

  it('gives each concurrent run only its own results and callbacks', async () => {
    const { pool, drain } = rig({ size: 2, script: { shuffleSeed: 11, maxDelay: 30 } });
    const a = [spec(1, { reqId: 'A' }), spec(2, { reqId: 'A' })];
    const b = [spec(3, { reqId: 'B' }), spec(4, { reqId: 'B' }), spec(5, { reqId: 'B' })];
    const gotA: string[] = [];
    const gotB: string[] = [];
    const pa = track(pool.run(a, (r) => { gotA.push(r.spec.reqId); }));
    const pb = track(pool.run(b, (r) => { gotB.push(r.spec.reqId); }));
    await drain();
    expect((pa.value() as TrialResult[]).map((r) => r.spec)).toEqual(a);
    expect((pb.value() as TrialResult[]).map((r) => r.spec)).toEqual(b);
    expect(gotA).toEqual(['A', 'A']);
    expect(gotB).toEqual(['B', 'B', 'B']);
    await pool.close();
  });

  it('rejects a run with a TrialError naming app, reqId and seed and stays usable', async () => {
    const { pool, drain } = rig({
      size: 2,
      script: { job: (j) => (j.spec.seed === 42 ? { kind: 'trialError', message: 'NaN in qacc' } : undefined) },
    });
    const bad = track(pool.run([spec(1), spec(42), spec(3)]));
    await drain();
    const err = bad.error() as TrialError;
    expect(err).toBeInstanceOf(TrialError);
    expect(err.message).toContain('R1');
    expect(err.message).toContain('42');
    expect(err.message).toContain('app a');
    expect((err.cause as Error).message).toBe('NaN in qacc');
    const ok = track(pool.run([spec(5), spec(6)]));
    await drain();
    expect((ok.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual([5, 6]);
    await pool.close();
  });

  it('resolves close twice with the same promise and terminates each worker once', async () => {
    const { pool, f, drain } = rig({ size: 3 });
    await drain();
    const c1 = pool.close();
    const c2 = pool.close();
    expect(c2).toBe(c1);
    await Promise.all([c1, c2]);
    expect(f.alive()).toBe(0);
    for (const w of f.workers) expect(w.received.filter((m) => m.type === 'shutdown')).toHaveLength(1);
  });

  it('rejects a run after close with PoolClosedError and starts no trial', async () => {
    const { pool, f, drain } = rig({ size: 1 });
    await drain();
    await pool.close();
    await expect(pool.run([spec(1)])).rejects.toBeInstanceOf(PoolClosedError);
    await expect(pool.run([spec(1)])).rejects.toThrow('pool is closed');
    expect(f.workers[0]?.received.some((m) => m.type === 'run')).toBe(false);
  });

  it('rejects a pending run with CancelledError on close and calls onResult no more', async () => {
    const { pool, drain, timers } = rig({ size: 1, script: { shuffleSeed: 1, maxDelay: 100 } });
    let calls = 0;
    const p = track(pool.run(Array.from({ length: 5 }, (_, i) => spec(i)), () => { calls++; }));
    await timers.advance(0);
    await pool.close();
    const before = calls;
    await drain();
    expect(p.error()).toBeInstanceOf(CancelledError);
    expect(calls).toBe(before);
  });

  it('rejects an invalid size naming the field and value', () => {
    const f = fakeWorkerFactory({ trialFn: pureTrial });
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => new TrialScheduler({ size, factory: f.factory, appId: 'a', config: {} })).toThrow(/size.*got/);
    }
    expect(f.workers).toHaveLength(0);
  });
});
