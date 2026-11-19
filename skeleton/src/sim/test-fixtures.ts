// Test-only fixtures. Not exported from index.ts.
import type { CompiledRequirement, Dimension, Mj, RobotApp, TrialSpec } from './types.js';

// ---------------------------------------------------------------- fake MuJoCo

export class FakeHandle {
  deleteCalls = 0;
  throwOnDelete = false;
  delete(): void {
    this.deleteCalls++;
    if (this.throwOnDelete) throw new Error('delete failed');
  }
}

export class FakeModel extends FakeHandle {
  constructor(readonly path: string) { super(); }
}

export class FakeContactVec extends FakeHandle {
  constructor(private readonly count: number) { super(); }
  size(): number { return this.count; }
  get(i: number): { index: number } { return { index: i }; }
}

export class FakeData extends FakeHandle {
  ncon = 0;
  constructor(readonly model: FakeModel, private readonly ctl: FakeMjControl) { super(); this.ncon = ctl.ncon; }
  get contact(): FakeContactVec { return this.ctl.track(new FakeContactVec(this.ncon)); }
}

export class FakeBuffer extends FakeHandle {
  readonly view: Float64Array;
  constructor(arg: number | ArrayLike<number>) {
    super();
    this.view = typeof arg === 'number' ? new Float64Array(arg) : Float64Array.from(arg);
  }
  GetView(): Float64Array { return this.view; }
  GetElementCount(): number { return this.view.length; }
}

export const FAKE_OBJ = { body: 1, joint: 3, geom: 5, site: 6, actuator: 19 } as const;

export interface FakeMjControl {
  mj: Mj;
  /** File contents by absolute path. */
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  /** Every handle created by the fake, in creation order. */
  handles: FakeHandle[];
  calls: {
    mkdirTree: string[]; writeFile: string[]; fromXmlPath: string[];
    name2id: Array<[number, string]>; addBuffer: number; geomDistance: number; dataCreated: number;
  };
  /** Fault injection. Each is thrown on the matching call while set. */
  fail: {
    mkdirTree?: Error; writeFile?: Error; fromXmlPath?: Error | ((path: string) => Error | undefined);
    buffer?: Error;
  };
  /** Names known to mj_name2id, by object type value. */
  names: Record<number, string[]>;
  ncon: number;
  geomDist: number;
  fromto: number[];
  track<T extends FakeHandle>(h: T): T;
  /** Sorted listing of every file and directory. */
  listing(): string[];
}

export function withFakeMj(): FakeMjControl {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  const handles: FakeHandle[] = [];
  const ctl = {
    files, dirs, handles,
    calls: { mkdirTree: [], writeFile: [], fromXmlPath: [], name2id: [], addBuffer: 0, geomDistance: 0, dataCreated: 0 },
    fail: {},
    names: {},
    ncon: 0,
    geomDist: 0.5,
    fromto: [0, 0, 0, 1, 1, 1],
    track<T extends FakeHandle>(h: T): T { handles.push(h); return h; },
    listing(): string[] { return [...dirs, ...files.keys()].sort(); },
  } as unknown as FakeMjControl;

  const FS = {
    mkdirTree(path: string): void {
      ctl.calls.mkdirTree.push(path);
      if (ctl.fail.mkdirTree) throw ctl.fail.mkdirTree;
      const parts = path.split('/').filter((s) => s !== '' && s !== '.');
      let cur = '';
      for (const p of parts) { cur += '/' + p; dirs.add(cur); }
    },
    writeFile(path: string, data: Uint8Array): void {
      ctl.calls.writeFile.push(path);
      if (ctl.fail.writeFile) throw ctl.fail.writeFile;
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!dirs.has(parent)) throw new Error(`ENOENT: ${parent}`);
      files.set(path, Uint8Array.from(data));
    },
    readFile(path: string): Uint8Array {
      const d = files.get(path);
      if (!d) throw new Error(`ENOENT: ${path}`);
      return d;
    },
    analyzePath(path: string): { exists: boolean } { return { exists: files.has(path) || dirs.has(path) }; },
  };

  class MjModel {
    static from_xml_path(path: string): FakeModel {
      ctl.calls.fromXmlPath.push(path);
      const f = ctl.fail.fromXmlPath;
      const err = typeof f === 'function' ? f(path) : f;
      if (err) throw err;
      if (!files.has(path)) throw new Error(`Could not open ${path}`);
      return ctl.track(new FakeModel(path));
    }
  }
  class MjData {
    constructor(model: FakeModel) {
      ctl.calls.dataCreated++;
      return ctl.track(new FakeData(model, ctl));
    }
  }
  class DoubleBuffer {
    constructor(arg: number | ArrayLike<number>) {
      if (ctl.fail.buffer) throw ctl.fail.buffer;
      return ctl.track(new FakeBuffer(arg));
    }
  }
  class MjVFS {
    addBuffer(): void { ctl.calls.addBuffer++; }
  }

  ctl.mj = {
    FS, MjModel, MjData, DoubleBuffer, MjVFS,
    mjtObj: Object.fromEntries(
      Object.entries(FAKE_OBJ).map(([k, v]) => [`mjOBJ_${k.toUpperCase()}`, { value: v }]),
    ),
    mj_name2id(_model: unknown, type: number, name: string): number {
      ctl.calls.name2id.push([type, name]);
      return (ctl.names[type] ?? []).indexOf(name);
    },
    mj_geomDistance(_m: unknown, _d: unknown, _g1: number, _g2: number, _max: number, buf: FakeBuffer): number {
      ctl.calls.geomDistance++;
      buf.view.set(ctl.fromto.slice(0, buf.view.length));
      return ctl.geomDist;
    },
    mj_step(): void { /* no physics in the fake */ },
  } as unknown as Mj;
  return ctl;
}

// ---------------------------------------------------------------- minimal app fixtures (no physics)

export const force: Dimension = { name: 'push.force', kind: 'force', min: 0, max: 200, severity: 'up' };
export const angle: Dimension = { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true };

export function miniApp(over: Partial<RobotApp> = {}): RobotApp {
  return {
    id: 'mini', name: 'mini', files: async () => ({}), sceneFile: 'scene.xml',
    simDt: 0.002, controlDt: 0.02, warmup: 0.2,
    lexicon: {
      robotNames: ['robot'], predicates: [],
      perturbations: [{ phrase: 'push', name: 'push', dims: () => [], apply: () => {} }],
    },
    makeController: () => ({ step: () => {} }),
    signals: () => {},
    ...over,
  };
}
export function miniReq(over: Partial<CompiledRequirement> = {}): CompiledRequirement {
  return {
    id: 'R1', source: 's', pattern: 'event', space: { dims: [force, angle] },
    perturbations: [{ template: 'push', params: { force: 'push.force', duration: 0.2, angle: 'push.angle' } }],
    horizon: 1, monitor: () => ({ robustness: 1, worstAt: 0, unit: 'm' }), ...over,
  };
}
export const miniSpec = (over: Partial<TrialSpec> = {}): TrialSpec => ({
  app: 'mini', reqId: 'R1', scenario: { 'push.force': 100, 'push.angle': 1 }, seed: 1, ...over,
});


