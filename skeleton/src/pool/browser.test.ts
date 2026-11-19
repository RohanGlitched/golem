import { afterEach, describe, expect, it } from 'vitest';
import type { TrialResult } from '../falsify/contract.js';
import { LoadError } from '../falsify/errors.js';
import { createBrowserPool, defaultBrowserPoolSize } from './browser.js';
import type { WorkerMessage } from './protocol.js';
import { TrialScheduler } from './scheduler.js';
import { fakeWorkerFactory, FakeTimers, tick, type FakeScript, type FakeWorkerFactory } from './testing.js';
import { pureTrial, spec, track } from './scheduler.testkit.js';

const g = globalThis as Record<string, unknown>;
const saved = { Worker: g['Worker'], navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };

function setNavigator(hardwareConcurrency: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency }, configurable: true, writable: true });
}

interface Made { url: string; opts: { type: string; name?: string }; terminated: boolean }

/** A fake global `Worker` whose instances are bridged to FakeWorkers from `fake`. */
function installFakeWorker(fake: FakeWorkerFactory): Made[] {
  const made: Made[] = [];
  class FakeGlobalWorker {
    private readonly rec: Made;
    private readonly inner;
    private readonly listeners: Record<string, ((e: { data?: unknown; message?: string }) => void)[]> = {};
    constructor(url: string | URL, opts: { type: string; name?: string }) {
      this.rec = { url: String(url), opts, terminated: false };
      made.push(this.rec);
      const [, slot, gen] = /golem-(\d+)-(\d+)/.exec(opts.name ?? '') ?? [];
      this.inner = fake.factory(Number(slot), Number(gen));
      this.inner.onMessage((m: WorkerMessage) => this.emit('message', { data: m }));
      this.inner.onCrash((r) => this.emit('error', { message: r }));
    }
    private emit(type: string, e: { data?: unknown; message?: string }): void { for (const cb of this.listeners[type] ?? []) cb(e); }
    addEventListener(type: string, cb: (e: { data?: unknown; message?: string }) => void): void { (this.listeners[type] ??= []).push(cb); }
    postMessage(msg: never, transfer: ArrayBuffer[]): void { this.inner.post(msg, transfer); }
    terminate(): void { this.rec.terminated = true; void this.inner.terminate(); }
  }
  g['Worker'] = FakeGlobalWorker;
  return made;
}

afterEach(() => {
  g['Worker'] = saved.Worker;
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  else delete g['navigator'];
});

describe('createBrowserPool', () => {
  it('defaults size from navigator.hardwareConcurrency', () => {
    const cases: [unknown, number][] = [[undefined, 1], [0, 1], [1.5, 1], [1, 1], [2, 1], [5, 4], [32, 8], ['8', 1]];
    for (const [hc, want] of cases) {
      setNavigator(hc);
      expect(defaultBrowserPoolSize()).toBe(want);
      const made = installFakeWorker(fakeWorkerFactory({ trialFn: pureTrial }));
      const pool = createBrowserPool({ appId: 'a' });
      expect(pool.size).toBe(want);
      expect(made).toHaveLength(want);
      void pool.close();
    }
  });

  it('uses an explicit size and rejects one outside 1..8 naming the field and value', () => {
    setNavigator(4);
    const made = installFakeWorker(fakeWorkerFactory({ trialFn: pureTrial }));
    expect(createBrowserPool({ appId: 'a', size: 8 }).size).toBe(8);
    made.length = 0;
    for (const size of [9, 0, 2.5]) {
      expect(() => createBrowserPool({ appId: 'a', size })).toThrow(new RegExp(`size.*got ${size}`));
    }
    expect(made).toHaveLength(0);
  });

  it('creates module workers and returns results through postMessage with transferred frames', async () => {
    const fake = fakeWorkerFactory({ trialFn: pureTrial });
    const made = installFakeWorker(fake);
    const pool = createBrowserPool({ appId: 'a', size: 2, entry: 'https://studio.example/browser-entry.js', config: { assetBase: '/robot/' } });
    expect(made.every((m) => m.opts.type === 'module')).toBe(true);
    const specs = [spec(1, { record: 'poses' }), spec(2)];
    const p = track(pool.run(specs));
    for (let i = 0; i < 10 && !p.settled(); i++) await tick();
    const got = p.value() as TrialResult[];
    expect(got.map((r) => r.robustness)).toEqual(specs.map((s) => (pureTrial(s) as TrialResult).robustness));
    expect(Array.from(got[0]?.poses?.frames ?? [])).toEqual(Array.from((pureTrial(specs[0]!) as TrialResult).poses!.frames));
    const init = fake.workers[0]?.received.find((m) => m.type === 'init');
    expect(init).toMatchObject({ config: { assetBase: '/robot/' } });
    await pool.close();
  });

  it('returns the pool at once and rejects run with the load failure message', async () => {
    installFakeWorker(fakeWorkerFactory({ trialFn: pureTrial, script: { loadFail: (s) => `worker ${s}: mujoco.wasm 404` } }));
    const pool = createBrowserPool({ appId: 'a', size: 3 });
    const err = await pool.run([spec(1)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect((err as Error).message).toContain('worker 0: mujoco.wasm 404'); // the first worker that failed
    await expect(pool.run([spec(2)])).rejects.toThrow('mujoco.wasm 404');
    await pool.close();
  });

  it('terminates every worker on close', async () => {
    const made = installFakeWorker(fakeWorkerFactory({ trialFn: pureTrial }));
    const pool = createBrowserPool({ appId: 'a', size: 4 });
    await pool.close();
    expect(made.every((m) => m.terminated)).toBe(true);
  });

  it('dispatches in the same order as the Node adapter scheduler for the same event script', async () => {
    const script: FakeScript = {
      shuffleSeed: 99, maxDelay: 30,
      job: (j) => (j.spec.seed === 4 && j.generation === 0 ? { kind: 'crash', delay: 3 } : undefined),
    };
    const order = async (useBrowser: boolean): Promise<string[]> => {
      const timers = new FakeTimers();
      const fake = fakeWorkerFactory({ trialFn: pureTrial, timers, script });
      let pool: TrialScheduler;
      if (useBrowser) {
        installFakeWorker(fake);
        pool = createBrowserPool({ appId: 'a', size: 3, timers });
      } else {
        // createNodePool builds exactly this scheduler around worker_threads; the fake stands in for the threads.
        pool = new TrialScheduler({ size: 3, factory: fake.factory, appId: 'a', config: {}, timers });
      }
      const a = track(pool.run(Array.from({ length: 9 }, (_, i) => spec(i))));
      const b = track(pool.run(Array.from({ length: 4 }, (_, i) => spec(100 + i))));
      await timers.settle();
      await tick();
      expect(a.settled() && b.settled()).toBe(true);
      const log = fake.workers.flatMap((w) => w.received.filter((m) => m.type === 'run').map((m) => ({ w: `${w.slot}/${w.generation}`, m })));
      await pool.close();
      return log.sort((x, y) => (x.m as { id: number }).id - (y.m as { id: number }).id).map((x) => `${x.w}:${(x.m as { spec: { seed: number } }).spec.seed}`);
    };
    const node = await order(false);
    const browser = await order(true);
    expect(browser).toEqual(node);
    expect(node.length).toBe(14); // 13 specs plus one crash retry
  });
});
