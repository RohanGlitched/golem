// Short MuJoCo integration test: the same specs give bit-identical results through InProcessPool and the
// Node adapter, and a worker's live handle count does not grow between its 1st and 100th trial.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import { InProcessPool } from './in-process.js';
import type { TrialScheduler } from './scheduler.js';
import { buildWorkerEntry, type WorkerBuild } from './worker-build.testkit.js';

// Skip only when MuJoCo or the sim trial entry is missing, and say why so the skip is never silent.
let skipReason: string | undefined;
let sim: typeof import('../sim/index.js') | undefined;
try {
  await import('@mujoco/mujoco');
} catch (e) {
  skipReason = `MuJoCo package @mujoco/mujoco not installed (${(e as Error).message})`;
}
if (skipReason === undefined) {
  try {
    sim = await import('../sim/index.js');
    if (typeof sim.runTrial !== 'function' || typeof sim.ModelCache !== 'function') skipReason = 'sim trial entry (runTrial, ModelCache) not exported';
  } catch (e) {
    skipReason = `sim trial entry not installed (${(e as Error).message})`;
  }
}
if (skipReason !== undefined) console.warn(`[skip] MuJoCo integration test: ${skipReason}`);

const HORIZON = 0.5; // seconds after warm-up; the shortest the test app needs to see a push

const APP_MODULE = `import { testApp, makeTestRequirement } from './sim/test-app.js';
export const app = testApp;
export const requirements = [makeTestRequirement({ horizon: ${HORIZON} })];
`;

const specs: TrialSpec[] = Array.from({ length: 40 }, (_, i) => ({
  app: 'test', reqId: 'R1',
  scenario: { 'push.force': (i * 7) % 21, 'push.angle': ((i * 37) % 360) * (Math.PI / 180) },
  seed: (i * 2654435761) >>> 0,
  ...(i % 4 === 0 ? { record: 'poses' as const } : {}),
}));

const bytes = (f: Float32Array) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

describe.skipIf(skipReason !== undefined)('MuJoCo pools (short horizon)', () => {
  let build: WorkerBuild;
  let appModuleUrl: string;
  let node: typeof import('./node.js');

  beforeAll(async () => {
    build = buildWorkerEntry(['sim/test-app.ts']);
    writeFileSync(join(build.outDir, 'app-module.js'), APP_MODULE);
    appModuleUrl = build.url('app-module.js').href;
    node = await import('./node.js');
  }, 120000);
  afterAll(() => build?.dispose());

  it('gives bit-identical robustness, worstAt, unit and poses through InProcessPool and the Node adapter', async () => {
    const s = sim as NonNullable<typeof sim>;
    const req = s.makeTestRequirement({ horizon: HORIZON });
    const cache = new s.ModelCache();
    const inproc = new InProcessPool((spec) => s.runTrial(s.testApp, req, spec, { cache }) as Promise<TrialResult>, { yieldEvery: 1000 });
    const ref = await inproc.run(specs);
    cache.dispose();

    const pool = await node.createNodePool({ appId: 'test', size: 2, entry: build.entry, config: { appModule: appModuleUrl } });
    try {
      const got = await pool.run(specs);
      got.forEach((r, i) => {
        const a = ref[i] as TrialResult;
        expect(r.spec).toBe(specs[i]);
        expect(Object.is(r.robustness, a.robustness)).toBe(true);
        expect(Object.is(r.worstAt, a.worstAt)).toBe(true);
        expect(r.unit).toBe(a.unit);
        expect(r.poses === undefined).toBe(a.poses === undefined);
        if (r.poses && a.poses) {
          expect(r.poses.nbody).toBe(a.poses.nbody);
          expect(r.poses.fps).toBe(a.poses.fps);
          expect(bytes(r.poses.frames).equals(bytes(a.poses.frames))).toBe(true);
        }
      });
      expect(new Set(ref.map((r) => r.robustness)).size).toBeGreaterThan(1); // the scenarios matter
      expect(ref.filter((r) => r.poses !== undefined && r.poses.frames.length > 0)).toHaveLength(10);
    } finally {
      await pool.close();
    }
  }, 120000);

  it('keeps a worker at the same live handle count after its 1st and its 100th trial', async () => {
    const pool: TrialScheduler = await node.createNodePool({ appId: 'test', size: 1, entry: build.entry, config: { appModule: appModuleUrl } });
    try {
      const shape = (i: number): TrialSpec => ({ app: 'test', reqId: 'R1', scenario: { 'push.force': 5 + (i % 10), 'push.angle': 1 }, seed: i });
      await pool.run([shape(0)]);
      const after1 = await pool.probe(0);
      await pool.run(Array.from({ length: 99 }, (_, i) => shape(i + 1)));
      const after100 = await pool.probe(0);
      expect(after1).toBeGreaterThanOrEqual(0);
      expect(after100).toBe(after1);
    } finally {
      await pool.close();
    }
  }, 120000);
});
