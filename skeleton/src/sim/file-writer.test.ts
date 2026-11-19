import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimError } from './errors.js';
import { validateRobotPaths, writeRobotFiles } from './file-writer.js';
import { loadMujoco } from './loader.js';
import { withFakeMj } from './test-fixtures.js';
import { PURE_RUNS, SEED } from './test-support.js';
import type { Mj } from './types.js';

const app = { id: 'a1', sceneFile: 'scene.xml' };
const bytes = (...b: number[]) => Uint8Array.from(b);

describe('writeRobotFiles (fake Mj)', () => {
  it.each([
    ['empty path', '', /""/],
    ['absolute path', '/etc/x', /\/etc\/x/],
    ['drive letter', 'C:x.xml', /C:x\.xml/],
    ['backslash', 'a\\b.xml', /a\\b\.xml/],
    ['.. segment', 'a/../b.xml', /a\/\.\.\/b\.xml/],
    ['empty segment', 'a//b.xml', /a\/\/b\.xml/],
    ['trailing slash', 'a/', /"a\/"/],
  ])('rejects %s naming the path and leaves the FS unchanged', (_n, bad, re) => {
    const f = withFakeMj();
    const before = f.listing();
    expect(() => writeRobotFiles(f.mj, app, { 'scene.xml': bytes(1), [bad]: bytes(2) })).toThrow(re);
    expect(f.listing()).toEqual(before);
    expect(f.calls.writeFile).toEqual([]);
  });
  it('rejects a missing scene file naming it', () => {
    const f = withFakeMj();
    expect(() => writeRobotFiles(f.mj, app, { 'other.xml': bytes(1) })).toThrow(/scene\.xml/);
    expect(f.calls.mkdirTree).toEqual([]);
  });
  it('rejects an empty record', () => {
    const f = withFakeMj();
    expect(() => writeRobotFiles(f.mj, app, {})).toThrow(/scene\.xml/);
  });
  it('names app id, path and cause when mkdirTree throws', () => {
    const f = withFakeMj();
    f.fail.mkdirTree = new Error('disk full');
    let err: unknown;
    try { writeRobotFiles(f.mj, app, { 'scene.xml': bytes(1) }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SimError);
    expect((err as SimError).message).toMatch(/a1/);
    expect((err as SimError).message).toMatch(/scene\.xml/);
    expect((err as SimError).message).toMatch(/disk full/);
    expect(((err as SimError).cause as Error).message).toBe('disk full');
  });
  it('writes a 0-byte file', () => {
    const f = withFakeMj();
    writeRobotFiles(f.mj, app, { 'scene.xml': new Uint8Array(0) });
    expect((f.mj as any).FS.readFile('/robot/scene.xml').length).toBe(0);
  });
  it('writes a 50 MiB file', () => {
    const f = withFakeMj();
    const big = new Uint8Array(50 * 1024 * 1024).fill(7);
    writeRobotFiles(f.mj, app, { 'scene.xml': big });
    expect((f.mj as any).FS.readFile('/robot/scene.xml').length).toBe(big.length);
  });
  it('overwrites on a second call and accepts existing directories', () => {
    const f = withFakeMj();
    writeRobotFiles(f.mj, app, { 'scene.xml': bytes(1), 'm/a.stl': bytes(2) });
    writeRobotFiles(f.mj, app, { 'scene.xml': bytes(3), 'm/a.stl': bytes(4) });
    expect([...(f.mj as any).FS.readFile('/robot/scene.xml')]).toEqual([3]);
    expect([...(f.mj as any).FS.readFile('/robot/m/a.stl')]).toEqual([4]);
  });
  it('writes in record key order and never uses addBuffer', () => {
    const f = withFakeMj();
    writeRobotFiles(f.mj, app, { 'z.bin': bytes(1), 'scene.xml': bytes(2), 'a/b.bin': bytes(3) });
    expect(f.calls.writeFile).toEqual(['/robot/z.bin', '/robot/scene.xml', '/robot/a/b.bin']);
    expect(f.calls.addBuffer).toBe(0);
  });
});

describe('writeRobotFiles (real Mj)', () => {
  let mj: Mj;
  beforeAll(async () => { mj = await loadMujoco(); });
  it('writes 200 small files (20 MiB or less in total) in 500 ms or less', () => {
    const files: Record<string, Uint8Array> = { 'scene.xml': bytes(1) };
    for (let i = 0; i < 200; i++) files[`meshes/m${i}.bin`] = new Uint8Array(100 * 1024).fill(i & 255);
    const t0 = performance.now();
    writeRobotFiles(mj, { id: 'timing', sceneFile: 'scene.xml' }, files, '/robot-timing');
    expect(performance.now() - t0).toBeLessThanOrEqual(500);
  });
});

// ---- properties

const seg = fc.stringMatching(/^[a-z0-9_]{1,6}$/);
const relPath = fc.array(seg, { minLength: 1, maxLength: 5 }).map((s) => s.join('/'));
const noPrefixClash = (paths: string[]): boolean =>
  paths.every((p) => paths.every((q) => p === q || !q.startsWith(p + '/')));

/** 1 to 10 files with valid relative paths, always including `scene.xml`. */
const arbByteMap = fc
  .uniqueArray(relPath, { minLength: 0, maxLength: 9 })
  .filter((ps) => noPrefixClash(['scene.xml', ...ps]) && !ps.includes('scene.xml'))
  .chain((ps) =>
    fc.tuple(...['scene.xml', ...ps].map(() => fc.uint8Array({ minLength: 0, maxLength: 4096 }))).map((datas) => {
      const rec: Record<string, Uint8Array> = {};
      ['scene.xml', ...ps].forEach((p, i) => { rec[p] = datas[i] as Uint8Array; });
      return rec;
    }),
  );

let runCounter = 0;
const BAD = ['', '/abs/x.xml', 'C:x.xml', 'a\\b.xml', 'a/../b.xml', 'a//b.xml', '../x.xml', 'a/'];

describe('writeRobotFiles properties', () => {
  // Feature: golem-sim, Property 15: File round trip
  it('reads back exactly the bytes written, and a second write overwrites', async () => {
    const mj = await loadMujoco();
    fc.assert(
      fc.property(arbByteMap, fc.nat(1000), (first, salt) => {
        const root = `/robot-prop-${runCounter++}`;
        writeRobotFiles(mj, app, first, root);
        for (const [p, b] of Object.entries(first)) {
          if (!equalBytes((mj as any).FS.readFile(`${root}/${p}`), b)) return false;
        }
        const second: Record<string, Uint8Array> = {};
        for (const [p, b] of Object.entries(first)) second[p] = b.map((x) => (x + salt + 1) & 255);
        writeRobotFiles(mj, app, second, root);
        return Object.entries(second).every(([p, b]) => equalBytes((mj as any).FS.readFile(`${root}/${p}`), b));
      }),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });

  // Feature: golem-sim, Property 16: Invalid paths change nothing
  it('rejects an invalid path anywhere and leaves the FS listing identical', () => {
    fc.assert(
      fc.property(arbByteMap, fc.constantFrom(...BAD), fc.nat(20), (valid, bad, pos) => {
        const keys = Object.keys(valid);
        keys.splice(pos % (keys.length + 1), 0, bad);
        const rec: Record<string, Uint8Array> = {};
        for (const k of keys) rec[k] = valid[k] ?? bytes(9);
        const f = withFakeMj();
        const before = f.listing();
        let err: unknown;
        try { writeRobotFiles(f.mj, app, rec); } catch (e) { err = e; }
        return err instanceof SimError && err.message.includes(`"${bad}"`) && sameList(f.listing(), before);
      }),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });

  it('rejects a record without its scene file and leaves the FS listing identical', () => {
    fc.assert(
      fc.property(arbByteMap, (valid) => {
        const rec = { ...valid };
        delete rec['scene.xml'];
        const f = withFakeMj();
        const before = f.listing();
        let err: unknown;
        try { writeRobotFiles(f.mj, app, rec); } catch (e) { err = e; }
        return err instanceof SimError && err.message.includes('scene.xml') && sameList(f.listing(), before);
      }),
      { numRuns: PURE_RUNS, seed: SEED },
    );
  });

  it('validateRobotPaths accepts every generated valid map', () => {
    fc.assert(fc.property(arbByteMap, (m) => { validateRobotPaths(app, m); return true; }), { numRuns: PURE_RUNS, seed: SEED });
  });
});

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
