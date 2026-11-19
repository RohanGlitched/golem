import { describe, expect, it } from 'vitest';
import { FakeBuffer, withFakeMj } from './test-fixtures.js';

describe('withFakeMj', () => {
  it('round-trips a file through FS', () => {
    const f = withFakeMj();
    const mj: any = f.mj;
    mj.FS.mkdirTree('/robot/a');
    mj.FS.writeFile('/robot/a/x.bin', new Uint8Array([1, 2, 3]));
    expect([...mj.FS.readFile('/robot/a/x.bin')]).toEqual([1, 2, 3]);
    expect(f.listing()).toEqual(['/', '/robot', '/robot/a', '/robot/a/x.bin']);
  });
  it('counts delete calls per handle', () => {
    const f = withFakeMj();
    const mj: any = f.mj;
    const b: FakeBuffer = new mj.DoubleBuffer(6);
    b.delete();
    b.delete();
    expect(b.deleteCalls).toBe(2);
    expect(f.handles).toEqual([b]);
  });
  it('rejects a write into a missing directory like Emscripten does', () => {
    const f = withFakeMj();
    expect(() => (f.mj as any).FS.writeFile('/nope/x', new Uint8Array(0))).toThrow(/ENOENT/);
  });
  it('injects faults on demand', () => {
    const f = withFakeMj();
    const mj: any = f.mj;
    f.fail.mkdirTree = new Error('disk full');
    expect(() => mj.FS.mkdirTree('/a')).toThrow('disk full');
    f.fail.fromXmlPath = new Error('bad xml');
    expect(() => mj.MjModel.from_xml_path('/a')).toThrow('bad xml');
    f.fail.buffer = new Error('oom');
    expect(() => new mj.DoubleBuffer(6)).toThrow('oom');
  });
  it('resolves names by object type value and returns -1 otherwise', () => {
    const f = withFakeMj();
    f.names[1] = ['pelvis'];
    const mj: any = f.mj;
    expect(mj.mj_name2id({}, mj.mjtObj.mjOBJ_BODY.value, 'pelvis')).toBe(0);
    expect(mj.mj_name2id({}, mj.mjtObj.mjOBJ_JOINT.value, 'pelvis')).toBe(-1);
  });
});
