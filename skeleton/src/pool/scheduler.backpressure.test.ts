import { describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory, tick } from './testing.js';
import { pureTrial, rig, spec, track } from './scheduler.testkit.js';

describe('TrialScheduler backpressure', () => {
  it('never holds more pose results waiting for delivery than the bound under a slow async onResult', async () => {
    const { pool, drain } = rig({ size: 3, sched: { deliveryBound: 2 } });
    const pending: (() => void)[] = [];
    let maxWaiting = 0;
    const specs = Array.from({ length: 10 }, (_, i) => spec(i, { record: 'poses' }));
    const p = track(pool.run(specs, () => new Promise<void>((res) => {
      pending.push(res);
      maxWaiting = Math.max(maxWaiting, pending.length);
    })));
    for (let round = 0; round < 50 && !p.settled(); round++) {
      await drain();
      pending.shift()?.();
      await tick();
    }
    expect(p.settled()).toBe(true);
    expect((p.value() as TrialResult[]).map((r) => r.spec.seed)).toEqual(specs.map((s) => s.seed));
    expect(maxWaiting).toBeLessThanOrEqual(2);
    await pool.close();
  });

  it('resumes dispatch in the same turn that a delivery frees capacity', async () => {
    const { pool, drain, dispatched } = rig({ size: 2, sched: { deliveryBound: 1 } });
    let release: (() => void) | undefined;
    const p = track(pool.run([spec(1, { record: 'poses' }), spec(2, { record: 'poses' })], () => new Promise<void>((res) => { release = res; })));
    await drain();
    expect(dispatched()).toHaveLength(1);
    const r = release as () => void;
    release = undefined;
    r();
    await Promise.resolve(); await Promise.resolve();
    expect(dispatched()).toHaveLength(2); // posted before any macrotask ran
    await drain();
    (release as (() => void) | undefined)?.();
    await drain();
    expect(p.settled()).toBe(true);
    await pool.close();
  });

  it('does not limit trials without poses', async () => {
    const { pool, drain, dispatched } = rig({ size: 3, sched: { deliveryBound: 1 } });
    const releases: (() => void)[] = [];
    const p = track(pool.run([spec(1), spec(2), spec(3)], () => new Promise<void>((res) => { releases.push(res); })));
    await drain();
    expect(dispatched()).toHaveLength(3);
    releases.forEach((r) => r());
    await drain();
    expect(p.settled()).toBe(true);
    await pool.close();
  });

  it('counts a throwing onResult as delivered and rejects its run with the cause', async () => {
    const { pool, drain } = rig({ size: 1, sched: { deliveryBound: 1 } });
    const boom = new Error('ui crashed');
    const p = track(pool.run([spec(1, { record: 'poses' }), spec(2, { record: 'poses' })], () => { throw boom; }));
    await drain();
    expect((p.error() as Error).cause).toBe(boom);
    const q = track(pool.run([spec(3, { record: 'poses' })], async () => undefined));
    await drain();
    expect((q.value() as TrialResult[])[0]?.spec.seed).toBe(3);
    await pool.close();
  });

  it('rejects an async onResult rejection with the cause', async () => {
    const { pool, drain } = rig({ size: 1 });
    const boom = new Error('late failure');
    const p = track(pool.run([spec(1)], () => Promise.reject(boom)));
    await drain();
    expect((p.error() as Error).cause).toBe(boom);
    await pool.close();
  });

  it('rejects deliveryBound = 0 at construction naming the field and value', () => {
    const f = fakeWorkerFactory({ trialFn: pureTrial });
    for (const deliveryBound of [0, -2, 1.5]) {
      expect(() => new TrialScheduler({ size: 2, deliveryBound, factory: f.factory, appId: 'a', config: {} }))
        .toThrow(new RegExp(`deliveryBound.*got ${String(deliveryBound).replace('.', '\\.')}`));
    }
    expect(f.workers).toHaveLength(0);
  });
});
