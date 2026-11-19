import { describe, expect, it } from 'vitest';
import type { TrialSpec } from '../falsify/contract.js';
import type { WorkerMessage } from './protocol.js';
import { fakeWorkerFactory, FakeTimers, tick, type FakeScript, type FakeWorker } from './testing.js';
import type { TrialFn } from './types.js';

const spec = (seed: number, record?: 'poses'): TrialSpec => ({ app: 'a', reqId: 'R1', scenario: { x: seed }, seed, ...(record ? { record } : {}) });
const trialFn: TrialFn = (s) => ({
  spec: s, robustness: 10 - (s.scenario['x'] as number), worstAt: 0, unit: 'm', wallMs: 0,
  ...(s.record === 'poses' ? { poses: { fps: 50, nbody: 1, frames: new Float32Array(14).fill(s.seed) } } : {}),
});

function boot(script?: FakeScript) {
  const f = fakeWorkerFactory({ trialFn, ...(script ? { script } : {}) });
  const w = f.factory(0, 0) as FakeWorker;
  const msgs: WorkerMessage[] = [];
  const crashes: string[] = [];
  w.onMessage((m) => msgs.push(m));
  w.onCrash((r) => crashes.push(r));
  w.post({ type: 'init', slot: 0, appId: 'a', config: {} });
  return { f, w, msgs, crashes };
}

describe('FakeWorker', () => {
  it('answers init with ready and a run with a result', async () => {
    const { w, msgs } = boot();
    await tick();
    w.post({ type: 'run', id: 1, spec: spec(3) });
    await tick();
    expect(msgs.map((m) => m.type)).toEqual(['ready', 'result']);
    expect(msgs[1]).toMatchObject({ id: 1, result: { robustness: 7 } });
  });
  it('fails the load with the scripted message', async () => {
    const { msgs } = boot({ loadFail: () => 'wasm missing' });
    await tick();
    expect(msgs[0]).toMatchObject({ type: 'loadError', message: 'wasm missing' });
  });
  it('delays ready with fake timers', async () => {
    const { f, msgs } = boot({ loadDelay: () => 50 });
    await tick();
    expect(msgs).toHaveLength(0);
    await f.timers.advance(49);
    expect(msgs).toHaveLength(0);
    await f.timers.advance(1);
    expect(msgs[0]).toMatchObject({ type: 'ready' });
  });
  it('crashes on a scripted job and reports the reason', async () => {
    const { w, msgs, crashes } = boot({ job: () => ({ kind: 'crash', reason: 'oom' }) });
    await tick();
    w.post({ type: 'run', id: 1, spec: spec(1) });
    await tick();
    expect(crashes).toEqual(['oom']);
    expect(msgs.filter((m) => m.type === 'result')).toHaveLength(0);
    expect(w.terminated).toBe(true);
  });
  it('posts a trial error for a scripted trialError', async () => {
    const { w, msgs } = boot({ job: () => ({ kind: 'trialError', message: 'bad scenario' }) });
    await tick();
    w.post({ type: 'run', id: 4, spec: spec(1) });
    await tick();
    expect(msgs[1]).toMatchObject({ type: 'trialError', id: 4, message: 'bad scenario' });
  });
  it('never answers a hanging job, and ignores cancel', async () => {
    const { w, msgs, f } = boot({ job: () => ({ kind: 'hang' }) });
    await tick();
    w.post({ type: 'run', id: 1, spec: spec(1) });
    w.post({ type: 'cancel', id: 1 });
    await f.timers.settle();
    await tick();
    expect(msgs.map((m) => m.type)).toEqual(['ready']);
  });
  it('completes in a seeded shuffled order when delays are random', async () => {
    const f = fakeWorkerFactory({ trialFn, script: { shuffleSeed: 5, maxDelay: 100 } });
    const ws = [0, 1, 2, 3, 4].map((s) => f.factory(s, 0));
    const order: number[] = [];
    ws.forEach((w) => w.onMessage((m) => { if (m.type === 'result') order.push(m.id); }));
    ws.forEach((w, i) => { w.post({ type: 'init', slot: i, appId: 'a', config: {} }); });
    await tick();
    ws.forEach((w, i) => { w.post({ type: 'run', id: i, spec: spec(i) }); });
    await f.timers.settle();
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(order).not.toEqual([0, 1, 2, 3, 4]);
  });
  it('detaches a transferred buffer on both directions', async () => {
    const { w, msgs } = boot();
    await tick();
    w.post({ type: 'run', id: 1, spec: spec(9, 'poses') });
    await tick();
    const m = msgs[1];
    expect(m).toMatchObject({ type: 'result' });
    if (m?.type !== 'result') return;
    expect(m.result.poses!.frames.byteLength).toBe(14 * 4);
    expect(m.result.poses!.frames.every((v) => v === 9)).toBe(true);
    // host -> worker transfer: the sender's buffer is detached
    const buf = new ArrayBuffer(8);
    w.post({ type: 'log' as never, level: 'info', message: 'x', buf } as never, [buf]);
    expect(buf.byteLength).toBe(0);
  });
  it('ignores messages after terminate', async () => {
    const { w, msgs } = boot();
    await tick();
    await w.terminate();
    w.post({ type: 'run', id: 1, spec: spec(1) });
    await tick();
    expect(msgs.map((m) => m.type)).toEqual(['ready']);
  });
});

describe('FakeTimers', () => {
  it('fires timers in time order and supports clearTimeout', async () => {
    const t = new FakeTimers();
    const out: string[] = [];
    t.setTimeout(() => out.push('b'), 20);
    t.setTimeout(() => out.push('a'), 10);
    const h = t.setTimeout(() => out.push('x'), 15);
    t.clearTimeout(h);
    await t.advance(25);
    expect(out).toEqual(['a', 'b']);
    expect(t.now).toBe(25);
  });
});
