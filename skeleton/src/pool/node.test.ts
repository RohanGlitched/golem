import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import { LoadError, TrialCrashError, TrialError } from '../falsify/errors.js';
import { createSeedDatabase } from '../falsify/seed-db.js';
import { InProcessPool } from './in-process.js';
import { createNodePool, defaultNodePoolSize } from './node.js';
import { nodeFileSystem } from './node-fs.js';
import { buildWorkerEntry, syntheticTrialModule, type WorkerBuild } from './worker-build.testkit.js';
// @ts-expect-error plain .mjs fixture without types
import { createTrialFn } from './fixtures/synthetic-trial.mjs';

const spec = (seed: number, record?: 'poses'): TrialSpec => ({ app: 'a', reqId: 'R1', scenario: { x: seed % 5 }, seed, ...(record ? { record } : {}) });
const exited = (w: Worker): Promise<void> => (w.threadId === -1 ? Promise.resolve() : new Promise((r) => { w.once('exit', () => r()); }));

let build: WorkerBuild;
beforeAll(() => { build = buildWorkerEntry(); }, 120000);
afterAll(() => build?.dispose());

describe('createNodePool', () => {
  it('runs trials on worker_threads with results equal to InProcessPool', async () => {
    const workers: Worker[] = [];
    const pool = await createNodePool({ appId: 'a', size: 3, entry: build.entry, config: { trialModule: syntheticTrialModule }, onWorker: (w) => workers.push(w) });
    expect(pool.size).toBe(3);
    expect(workers).toHaveLength(3);
    const specs = Array.from({ length: 20 }, (_, i) => spec(i, i % 3 === 0 ? 'poses' : undefined));
    const got = await pool.run(specs);
    const ref = await new InProcessPool(createTrialFn('a', {})).run(specs);
    const pick = (r: TrialResult) => ({ spec: r.spec, robustness: r.robustness, worstAt: r.worstAt, unit: r.unit, frames: r.poses ? Array.from(r.poses.frames) : null });
    expect(got.map(pick)).toEqual(ref.map(pick));
    got.forEach((r, i) => expect(r.spec).toBe(specs[i]));
    await pool.close();
    await Promise.all(workers.map(exited));
  }, 60000);

  it('transfers poses.frames, leaving the worker copy with byte length 0', async () => {
    const pool = await createNodePool({ appId: 'a', size: 1, entry: build.entry, config: { trialModule: syntheticTrialModule, reportTransfer: true } });
    const [first, second] = await pool.run([spec(1, 'poses'), spec(2)]);
    expect(first?.poses?.frames.byteLength).toBeGreaterThan(0);
    expect((second as TrialResult & { prevFramesByteLength: number }).prevFramesByteLength).toBe(0);
    await pool.close();
  }, 60000);

  it('rejects construction for a module that fails to load, naming the worker, and leaves no worker running', async () => {
    const workers: Worker[] = [];
    const err = await createNodePool({
      appId: 'a', size: 2, entry: build.entry, config: { trialModule: syntheticTrialModule, loadFailSlot: 'mujoco.wasm: file not found' },
      onWorker: (w) => workers.push(w),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect((err as Error).message).toMatch(/worker [01] failed to load/);
    expect((err as Error).message).toContain('mujoco.wasm: file not found');
    expect(((err as Error).cause as Error).message).toBe('mujoco.wasm: file not found');
    await Promise.all(workers.map(exited));
    expect(workers.every((w) => w.threadId === -1)).toBe(true);
  }, 60000);

  it('rejects construction when the worker script itself throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-bad-entry-'));
    const bad = join(dir, 'bad.mjs');
    writeFileSync(bad, "throw new Error('cannot import mujoco');\n");
    const workers: Worker[] = [];
    try {
      const err = await createNodePool({ appId: 'a', size: 1, entry: pathToFileURL(bad), onWorker: (w) => workers.push(w) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LoadError);
      expect((err as Error).message).toContain('worker 0');
      expect((err as Error).message).toContain('cannot import mujoco');
      await Promise.all(workers.map(exited));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it('reports a trial error with the spec and stays usable', async () => {
    const pool = await createNodePool({ appId: 'a', size: 2, entry: build.entry, config: { trialModule: syntheticTrialModule, throwSeed: 13 } });
    const err = await pool.run([spec(12), spec(13)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrialError);
    expect((err as Error).message).toContain('seed 13');
    expect(((err as Error).cause as Error).message).toBe('synthetic failure at seed 13');
    await expect(pool.run([spec(14)])).resolves.toHaveLength(1);
    await pool.close();
  }, 60000);

  it('replaces a worker that exits mid-trial and rejects a trial that kills two workers', async () => {
    const workers: Worker[] = [];
    const pool = await createNodePool({ appId: 'a', size: 1, entry: build.entry, config: { trialModule: syntheticTrialModule, exitSeed: 66 }, onWorker: (w) => workers.push(w) });
    const err = await pool.run([spec(66)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrialCrashError);
    expect((err as Error).message).toContain('crashed two workers');
    expect(workers.length).toBe(3); // first, retry, and the replacement after the second crash
    expect(pool.size).toBe(1);
    await expect(pool.run([spec(1)])).resolves.toHaveLength(1);
    await pool.close();
    await Promise.all(workers.map(exited));
  }, 60000);

  it('closes cleanly, twice', async () => {
    const workers: Worker[] = [];
    const pool = await createNodePool({ appId: 'a', size: 2, entry: build.entry, config: { trialModule: syntheticTrialModule }, onWorker: (w) => workers.push(w) });
    await Promise.all([pool.close(), pool.close()]);
    await Promise.all(workers.map(exited));
    expect(workers.every((w) => w.threadId === -1)).toBe(true);
  }, 60000);

  it('rejects an invalid size naming the field and value, starting no worker', async () => {
    for (const size of [0, -3, 2.5]) {
      const workers: Worker[] = [];
      await expect(createNodePool({ appId: 'a', size, entry: build.entry, onWorker: (w) => workers.push(w) })).rejects.toThrow(new RegExp(`size.*got ${size}`));
      expect(workers).toHaveLength(0);
    }
  });

  it('defaults size to the available cores minus one, at least 1', () => {
    expect(defaultNodePoolSize()).toBeGreaterThanOrEqual(1);
  });
});

describe('nodeFileSystem', () => {
  it('round trips a seed file in a temp directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-seeds-'));
    try {
      const db = createSeedDatabase(nodeFileSystem(), dir);
      const ce = { reqId: 'R2', scenario: { 'push.force': 168, 'push.angle': 2.356 }, seed: 2780164117, robustness: -0.04, shrunk: true, foundAfter: 57 };
      expect(await db.add('stagger', ce)).toBe('added');
      expect(await db.add('stagger', ce)).toBe('duplicate');
      expect(await db.read('stagger', 'R2')).toEqual([ce]);
      await expect(nodeFileSystem().readFile(join(dir, 'missing.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      await nodeFileSystem().remove(join(dir, 'missing.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
