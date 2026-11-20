import { afterEach, describe, expect, it } from 'vitest';
import { SimError } from './errors.js';
import { __setLoadFnForTests, isLoadProgressNoise, loadMujoco } from './loader.js';
import type { Mj } from './types.js';

afterEach(() => __setLoadFnForTests(undefined));

const fakeMj = (): Mj => ({ tag: 'fake' }) as unknown as Mj;

describe('loadMujoco with a fake load function', () => {
  it('returns the same object by reference on repeated calls', async () => {
    const obj = fakeMj();
    __setLoadFnForTests(async () => obj);
    expect(await loadMujoco()).toBe(obj);
    expect(await loadMujoco()).toBe(obj);
  });
  it('loads once when calls overlap', async () => {
    let n = 0;
    __setLoadFnForTests(async () => { n++; await new Promise((r) => setTimeout(r, 5)); return fakeMj(); });
    const [a, b, c] = await Promise.all([loadMujoco(), loadMujoco(), loadMujoco()]);
    expect(n).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it('rejects every waiter with the same error when the load fails', async () => {
    __setLoadFnForTests(async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('wasm 404'); });
    const results = await Promise.allSettled([loadMujoco(), loadMujoco()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    const [x, y] = results as PromiseRejectedResult[];
    expect(x!.reason).toBe(y!.reason);
  });
  it('names the package and the cause in the message', async () => {
    __setLoadFnForTests(async () => { throw new Error('wasm 404'); });
    const err = await loadMujoco().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimError);
    expect((err as SimError).message).toContain('@mujoco/mujoco');
    expect((err as SimError).message).toContain('wasm 404');
    expect(((err as SimError).cause as Error).message).toBe('wasm 404');
  });
  it('starts a new load after a failure, also when the retry runs inside a catch', async () => {
    let n = 0;
    const obj = fakeMj();
    __setLoadFnForTests(async () => { if (n++ === 0) throw new Error('first'); return obj; });
    const result = await loadMujoco().catch(() => loadMujoco());
    expect(result).toBe(obj);
    expect(n).toBe(2);
  });
  it('handles a load function that throws synchronously', async () => {
    __setLoadFnForTests(() => { throw new Error('sync'); });
    await expect(loadMujoco()).rejects.toThrow(/sync/);
    const obj = fakeMj();
    __setLoadFnForTests(async () => obj);
    expect(await loadMujoco()).toBe(obj);
  });
});

describe('loadMujoco with real MuJoCo', () => {
  it('loads in 2 s or less, exposes the needed API and returns the same object in 10 ms or less', async () => {
    __setLoadFnForTests(undefined);
    const t0 = performance.now();
    const mj: any = await loadMujoco();
    expect(performance.now() - t0).toBeLessThanOrEqual(2000);
    for (const k of ['MjModel', 'MjData', 'mj_step', 'mj_name2id', 'mj_geomDistance', 'DoubleBuffer', 'FS']) {
      expect(mj[k], k).toBeDefined();
    }
    const t1 = performance.now();
    const again = await loadMujoco();
    expect(performance.now() - t1).toBeLessThanOrEqual(10);
    expect(again).toBe(mj);
  });
});

describe('isLoadProgressNoise', () => {
  it("drops Emscripten's cold-load progress lines and keeps everything else", () => {
    expect(isLoadProgressNoise('still waiting on run dependencies:')).toBe(true);
    expect(isLoadProgressNoise('dependency: wasm-instantiate')).toBe(true);
    expect(isLoadProgressNoise('(end of list)')).toBe(true);
    expect(isLoadProgressNoise('XML Error: Schema violation')).toBe(false);
    expect(isLoadProgressNoise('Aborted(OOM)')).toBe(false);
  });
});
