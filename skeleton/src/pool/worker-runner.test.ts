import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { TrialSpec } from '../falsify/contract.js';
import type { HostMessage, WorkerMessage } from './protocol.js';
import { HandleTracker, WorkerRunner, type LoadedTrial } from './worker-runner.js';
import { defaultTrialLoader } from './trial-loader.js';

const spec = (seed = 1, x = 1): TrialSpec => ({ app: 'a', reqId: 'R1', scenario: { x }, seed });
const fixture = pathToFileURL(new URL('./fixtures/synthetic-trial.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;

function harness(loaded: LoadedTrial) {
  const out: WorkerMessage[] = [];
  const runner = new WorkerRunner(async () => loaded);
  const send = (m: HostMessage) => runner.handle(m, (w) => { out.push(w); });
  return { out, runner, send };
}
const init: HostMessage = { type: 'init', slot: 2, appId: 'a', config: {} };

describe('WorkerRunner', () => {
  it('posts ready after loading once', async () => {
    let loads = 0;
    const out: WorkerMessage[] = [];
    const runner = new WorkerRunner(async () => { loads++; return { trial: (s) => ({ spec: s, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0 }) }; });
    await runner.handle(init, (m) => { out.push(m); });
    await runner.handle(init, (m) => { out.push(m); });
    expect(loads).toBe(1);
    expect(out).toEqual([{ type: 'ready', slot: 2 }, { type: 'ready', slot: 2 }]);
  });
  it('posts loadError with the message when loading fails', async () => {
    const out: WorkerMessage[] = [];
    const runner = new WorkerRunner(async () => { throw new Error('no wasm'); });
    await runner.handle(init, (m) => { out.push(m); });
    expect(out[0]).toMatchObject({ type: 'loadError', slot: 2, message: 'no wasm' });
  });
  it('posts a result and releases every tracked handle after success', async () => {
    const deleted: number[] = [];
    const h = harness({ trial: (s, t) => { for (let i = 0; i < 3; i++) t!.track({ delete: () => { deleted.push(i); } }); return { spec: s, robustness: 2, worstAt: 0, unit: 'm', wallMs: 0 }; } });
    await h.send(init);
    await h.send({ type: 'run', id: 5, spec: spec() });
    expect(h.out[1]).toMatchObject({ type: 'result', id: 5 });
    expect(deleted).toEqual([2, 1, 0]);
    expect(h.runner.liveHandles()).toBe(0);
  });
  it('releases handles and posts trialError when the trial throws', async () => {
    let deleted = 0;
    const h = harness({ trial: (_s, t) => { t!.track({ delete: () => { deleted++; } }); throw new Error('boom'); } });
    await h.send(init);
    await h.send({ type: 'run', id: 1, spec: spec() });
    expect(h.out[1]).toMatchObject({ type: 'trialError', id: 1, message: 'boom' });
    expect(deleted).toBe(1);
  });
  it('releases handles for a cancelled trial and still posts its result', async () => {
    let deleted = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ trial: async (s, t) => { t!.track({ delete: () => { deleted++; } }); await gate; return { spec: s, robustness: t!.isCancelled() ? -1 : 1, worstAt: 0, unit: 'm', wallMs: 0 }; } });
    await h.send(init);
    const running = h.send({ type: 'run', id: 9, spec: spec() });
    await h.send({ type: 'cancel', id: 9 });
    release();
    await running;
    expect(deleted).toBe(1);
    expect(h.out[1]).toMatchObject({ type: 'result', id: 9, result: { robustness: -1 } });
  });
  it('reports a delete failure as a trial error', async () => {
    const h = harness({ trial: (s, t) => { t!.track({ delete: () => { throw new Error('double free'); } }); return { spec: s, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0 }; } });
    await h.send(init);
    await h.send({ type: 'run', id: 1, spec: spec() });
    expect(h.out[1]).toMatchObject({ type: 'trialError', message: 'double free' });
  });
  it('answers probe with the same live handle count after the 1st and the 100th trial', async () => {
    const base = 4;
    const h = harness({ trial: (s, t) => { t!.track({ delete: () => undefined }); return { spec: s, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0 }; }, liveHandles: () => base });
    await h.send(init);
    await h.send({ type: 'run', id: 1, spec: spec() });
    await h.send({ type: 'probe', id: 100 });
    for (let i = 2; i <= 100; i++) await h.send({ type: 'run', id: i, spec: spec(i) });
    await h.send({ type: 'probe', id: 101 });
    const probes = h.out.filter((m) => m.type === 'probeReply');
    expect(probes.map((p) => p.type === 'probeReply' && p.liveHandles)).toEqual([4, 4]);
  });
  it('rejects a trial that arrives before init with a trialError', async () => {
    const h = harness({ trial: (s) => ({ spec: s, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0 }) });
    await h.send({ type: 'run', id: 1, spec: spec() });
    expect(h.out[0]).toMatchObject({ type: 'trialError', message: expect.stringMatching(/before it finished loading/) });
  });
  it('transfers poses frames with the result', async () => {
    const posted: { m: WorkerMessage; t?: ArrayBuffer[] }[] = [];
    const frames = new Float32Array(14);
    const runner = new WorkerRunner(async () => ({ trial: (s) => ({ spec: s, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0, poses: { fps: 50, nbody: 1, frames } }) }));
    await runner.handle(init, () => undefined);
    await runner.handle({ type: 'run', id: 1, spec: spec() }, (m, t) => { posted.push({ m, ...(t ? { t } : {}) }); });
    expect(posted[0]!.t).toEqual([frames.buffer]);
  });
});

describe('HandleTracker', () => {
  it('deletes each handle once, last created first', () => {
    const order: string[] = [];
    const t = new HandleTracker();
    t.track({ delete: () => order.push('a') });
    t.track({ delete: () => order.push('b') });
    t.releaseAll();
    t.releaseAll();
    expect(order).toEqual(['b', 'a']);
    expect(t.live).toBe(0);
  });
});

describe('defaultTrialLoader', () => {
  it('uses a synthetic trialModule and never loads the sim module or MuJoCo', async () => {
    const simImport = vi.fn();
    vi.doMock('../sim/index.js', () => { simImport(); return {}; });
    const loaded = await defaultTrialLoader('a', { trialModule: fixture });
    const r = await loaded.trial(spec(3, 4));
    expect(r.robustness).toBeCloseTo(10 - 4 + 3 / 100, 12);
    expect(simImport).not.toHaveBeenCalled();
    vi.doUnmock('../sim/index.js');
  });
  it('rejects a trial module without createTrialFn, and a config without any module', async () => {
    await expect(defaultTrialLoader('a', { trialModule: pathToFileURL(process.execPath).href.replace(/node\.exe$/, 'none.mjs') })).rejects.toThrow();
    await expect(defaultTrialLoader('a', {})).rejects.toThrow(/trialModule.*appModule/);
  });
});
