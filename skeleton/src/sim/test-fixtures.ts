// Test-only fixtures. Not exported from index.ts.
import { runtimeOf } from './test-app.js';
import type {
  CompiledRequirement, Controller, Dimension, Mj, PerturbationTemplate, RobotApp, SimContext, TrialSpec,
} from './types.js';

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



// ---------------------------------------------------------------- behaviour wrappers (Test_App based)
// Each wrapper changes exactly one behaviour of the app it wraps.

/** controller.step throws at the given 0-based call index (warm-up calls count). */
export function withThrowingController(app: RobotApp, atStep: number): RobotApp {
  return {
    ...app,
    makeController(ctx, rng): Controller {
      const inner = app.makeController(ctx, rng);
      let n = 0;
      return {
        step(c, t) {
          if (n++ === atStep) throw new Error(`controller failed at step ${atStep}`);
          inner.step(c, t);
        },
      };
    },
  };
}

/** app.signals throws at the given 0-based call index. */
export function withThrowingSignals(app: RobotApp, atStep: number): RobotApp {
  const counts = new WeakMap<SimContext, number>();
  return {
    ...app,
    signals(ctx, out) {
      const n = counts.get(ctx) ?? 0;
      counts.set(ctx, n + 1);
      if (n === atStep) throw new Error(`signals failed at step ${atStep}`);
      app.signals(ctx, out);
    },
  };
}

const AUTORESET_BIT = 65536; // mjDSBL_AUTORESET in MuJoCo 4.x
/**
 * At control step `atStep` the controller writes NaN into ctrl and into the hinge qpos.
 * MuJoCo's auto-reset would silently repair that, so the wrapper turns auto-reset off for the
 * trial and restores it in endTrial. (NaN in ctrl alone does not make qpos non-finite.)
 */
export function withNaNControl(app: RobotApp, atStep: number): RobotApp {
  return {
    ...app,
    makeController(ctx, rng): Controller {
      const inner = app.makeController(ctx, rng);
      ctx.model.opt.disableflags = ctx.model.opt.disableflags | AUTORESET_BIT;
      let n = 0;
      return {
        step(c, t) {
          inner.step(c, t);
          if (n++ === atStep) {
            const rt = runtimeOf(c);
            rt.ctrl[rt.driveId] = NaN;
            rt.qpos[rt.hingeAdr] = NaN;
          }
        },
      };
    },
    endTrial(ctx) {
      ctx.model.opt.disableflags = ctx.model.opt.disableflags & ~AUTORESET_BIT;
      app.endTrial?.(ctx);
    },
  };
}

/** Adds a template named `alter` that changes body_mass, geom_friction and opt.gravity when applied. */
export function withModelAlteringTemplate(app: RobotApp): RobotApp {
  const alter: PerturbationTemplate = {
    phrase: 'the model is altered',
    name: 'alter',
    dims: () => [],
    apply(ctx) {
      const m = ctx.model;
      const bob = ctx.ids['body:bob'] as number;
      m.body_mass[bob] = 1.5;
      m.geom_friction[0] = 0.1;
      m.opt.gravity[2] = -1;
    },
  };
  return { ...app, lexicon: { ...app.lexicon, perturbations: [...app.lexicon.perturbations, alter] } };
}

export interface SpyEntry {
  name: string; t: number; tTrigger: number; values: Record<string, number>; xfrc: Float64Array;
  /** MuJoCo data.time when the call was made. */
  simTime: number;
}
/** Adds a template (default name `spy`) that records every apply call into `log`. */
export function withSpyTemplate(app: RobotApp, log: SpyEntry[], name = 'spy'): RobotApp {
  const spy: PerturbationTemplate = {
    phrase: `spy ${name}`,
    name,
    dims: () => [],
    apply(ctx, t, tTrigger, values) {
      log.push({ name, t, tTrigger, values, xfrc: Float64Array.from(ctx.data.xfrc_applied as Float64Array), simTime: ctx.data.time });
    },
  };
  return { ...app, lexicon: { ...app.lexicon, perturbations: [...app.lexicon.perturbations, spy] } };
}

/** initState and the controller draw no PRNG value: the initial hinge angle is the fixed 0.05 rad. */
export function withNoDraws(app: RobotApp): RobotApp {
  return {
    ...app,
    initState(ctx) {
      const rt = runtimeOf(ctx);
      rt.qpos[rt.hingeAdr] = 0.05;
    },
  };
}

