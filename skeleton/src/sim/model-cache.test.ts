import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { liveHandleCount } from './handles.js';
import { ModelCache } from './model-cache.js';
import { FakeModel, miniApp, withFakeMj } from './test-fixtures.js';
import { PURE_RUNS, SEED } from './test-support.js';
import type { RobotApp } from './types.js';

function setup(failFirst: Record<string, boolean> = {}) {
  const f = withFakeMj();
  const filesCalls: Record<string, number> = {};
  const attempts: Record<string, number> = {};
  const cache = new ModelCache({ load: async () => f.mj });
  const mk = (id: string, over: Partial<RobotApp> = {}): RobotApp =>
    miniApp({
      id,
      files: async () => {
        filesCalls[id] = (filesCalls[id] ?? 0) + 1;
        attempts[id] = (attempts[id] ?? 0) + 1;
        await Promise.resolve();
        if (failFirst[id] && attempts[id] === 1) throw new Error(`cannot read ${id}`);
        return { 'scene.xml': new Uint8Array([1]) };
      },
      ...over,
    });
  return { f, cache, mk, filesCalls };
}

describe('ModelCache', () => {
  it('calls files() once and a hit skips files(), FS and compile', async () => {
    const { f, cache, mk, filesCalls } = setup();
    const app = mk('a');
    const first = await cache.getModel(app);
    const writes = f.calls.writeFile.length;
    const second = await cache.getModel(app);
    expect(second.model).toBe(first.model);
    expect(filesCalls['a']).toBe(1);
    expect(f.calls.writeFile.length).toBe(writes);
    expect(f.calls.fromXmlPath).toHaveLength(1);
  });
  it('shares one compile between concurrent requests', async () => {
    const { f, cache, mk, filesCalls } = setup();
    const app = mk('a');
    const [x, y, z] = await Promise.all([cache.getModel(app), cache.getModel(app), cache.getModel(app)]);
    expect(x.model).toBe(y.model);
    expect(y.model).toBe(z.model);
    expect(filesCalls['a']).toBe(1);
    expect(f.calls.fromXmlPath).toHaveLength(1);
  });
  it('leaves no entry after a failure, keeps other ids, and retries', async () => {
    const { cache, mk, filesCalls } = setup({ bad: true });
    await cache.getModel(mk('good'));
    await expect(cache.getModel(mk('bad'))).rejects.toThrow(/cannot read bad/);
    expect(cache.has('bad')).toBe(false);
    expect(cache.has('good')).toBe(true);
    await cache.getModel(mk('bad'));
    expect(cache.has('bad')).toBe(true);
    expect(filesCalls['bad']).toBe(2);
  });
  it('includes the app id and the compiler message in the error', async () => {
    const { f, cache, mk } = setup();
    f.fail.fromXmlPath = new Error('XML Error: bad tag');
    await expect(cache.getModel(mk('robo'))).rejects.toThrow(/robo.*XML Error: bad tag/);
    expect(f.handles.filter((h) => h instanceof FakeModel)).toHaveLength(0);
  });
  it('dispose deletes each settled model once, and a later request compiles again', async () => {
    const { f, cache, mk, filesCalls } = setup();
    const before = liveHandleCount();
    const { model } = await cache.getModel(mk('a'));
    expect(liveHandleCount()).toBe(before + 1);
    cache.dispose();
    cache.dispose();
    expect(model.deleteCalls).toBe(1);
    expect(liveHandleCount()).toBe(before);
    expect(cache.size).toBe(0);
    await cache.getModel(mk('a'));
    expect(filesCalls['a']).toBe(2);
    expect(f.calls.fromXmlPath).toHaveLength(2);
    cache.dispose();
  });
  it('deletes a compile that finishes after dispose and rejects', async () => {
    const { f, cache, mk } = setup();
    const pending = cache.getModel(mk('a'));
    cache.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    const models = f.handles.filter((h) => h instanceof FakeModel);
    expect(models.map((m) => m.deleteCalls)).toEqual([1]);
    expect(cache.has('a')).toBe(false);
  });
});

// Feature: golem-sim, Property 17: Model cache compiles once and recovers
describe('ModelCache properties', () => {
  const arbRound = fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 5 });
  it('compiles once per id, recovers from failures and disposes cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ a: fc.boolean(), b: fc.boolean(), c: fc.boolean() }),
        fc.array(arbRound, { minLength: 1, maxLength: 5 }),
        async (failFirst, rounds) => {
          const { f, cache, mk, filesCalls } = setup(failFirst);
          const before = liveHandleCount();
          const apps = { a: mk('a'), b: mk('b'), c: mk('c') };
          const compiled = new Map<string, any>();
          const failed = new Set<string>();
          const expectedFiles: Record<string, number> = {};
          for (const round of rounds) {
            const results = await Promise.allSettled(round.map((id) => cache.getModel(apps[id as 'a'])));
            for (const id of new Set(round)) {
              const mine = results.filter((_, i) => round[i] === id);
              if (compiled.has(id)) {
                if (!mine.every((r) => r.status === 'fulfilled' && r.value.model === compiled.get(id))) return false;
              } else {
                expectedFiles[id] = (expectedFiles[id] ?? 0) + 1;
                if (failFirst[id as 'a'] && !failed.has(id)) {
                  failed.add(id);
                  if (!mine.every((r) => r.status === 'rejected') || cache.has(id)) return false;
                } else {
                  const models = mine.map((r) => (r.status === 'fulfilled' ? r.value.model : undefined));
                  if (models.some((m) => m === undefined || m !== models[0])) return false;
                  compiled.set(id, models[0]);
                }
              }
            }
          }
          for (const id of Object.keys(expectedFiles)) if (filesCalls[id] !== expectedFiles[id]) return false;
          if (f.calls.fromXmlPath.length !== compiled.size) return false;
          cache.dispose();
          for (const m of compiled.values()) if (m.deleteCalls !== 1) return false;
          if (liveHandleCount() !== before) return false;
          await cache.getModel(apps.a).catch(() => undefined);
          const again = (filesCalls['a'] ?? 0) === (expectedFiles['a'] ?? 0) + 1;
          cache.dispose();
          return again && liveHandleCount() === before;
        },
      ),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });
});
