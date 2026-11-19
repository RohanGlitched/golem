// Test_App: a tiny inline pendulum-and-box app, so CI needs no robot assets.
// Imports only contract types from inside sim.
import type {
  CompiledRequirement, Controller, EarlyStopHook, PerturbationCall, PerturbationTemplate, Quantity,
  RobotApp, SimContext, Trace,
} from './types.js';

const SCENE_XML = `<mujoco model="golem-test">
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <body name="box" pos="1 0 1">
      <freejoint name="box_free"/>
      <geom type="box" size="0.1 0.1 0.1" mass="1"/>
    </body>
    <body name="bob" pos="-1 0 1">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="0.02"/>
      <geom type="capsule" fromto="0 0 0 0 0 -0.5" size="0.03" mass="0.5"/>
    </body>
  </worldbody>
  <actuator>
    <motor name="drive" joint="hinge" ctrlrange="-5 5"/>
  </actuator>
</mujoco>
`;

const KP = 2;
const KD = 0.5;
const TORQUE_LIMIT = 5;
const DEFAULT_MAX_FORCE = 20;

/** Per-trial runtime state: cached live views and ids. Re-fetched when WASM memory growth detaches a view. */
interface Rt {
  qpos: Float64Array; qvel: Float64Array; ctrl: Float64Array; xfrc: Float64Array; xpos: Float64Array;
  hingeAdr: number; hingeDof: number; boxId: number; bobId: number; driveId: number;
}
const RT = new WeakMap<SimContext, Rt>();

function readViews(rt: Rt, data: any): void {
  rt.qpos = data.qpos; rt.qvel = data.qvel; rt.ctrl = data.ctrl;
  rt.xfrc = data.xfrc_applied; rt.xpos = data.xpos;
}

export function runtimeOf(ctx: SimContext): Rt {
  let rt = RT.get(ctx);
  if (rt === undefined) {
    const jointId = ctx.ids['joint:hinge'] as number;
    rt = {
      hingeAdr: ctx.model.jnt_qposadr[jointId], hingeDof: ctx.model.jnt_dofadr[jointId],
      boxId: ctx.ids['body:box'] as number, bobId: ctx.ids['body:bob'] as number,
      driveId: ctx.ids['actuator:drive'] as number,
    } as Rt;
    readViews(rt, ctx.data);
    RT.set(ctx, rt);
  } else if (rt.qpos.buffer.byteLength === 0) {
    readViews(rt, ctx.data);
  }
  return rt;
}

function rangeMax(slot: Quantity | [Quantity, Quantity] | string | undefined): number {
  if (Array.isArray(slot)) return slot[1].si;
  if (slot !== undefined && typeof slot === 'object') return slot.si;
  return DEFAULT_MAX_FORCE;
}

export function makePushTemplate(): PerturbationTemplate {
  return {
    phrase: 'the bob is pushed with {range:force} for {duration} from {direction}',
    name: 'push',
    dims: (slots) => [
      { name: 'push.force', kind: 'force', min: 0, max: rangeMax(slots['force'] ?? slots['range']), severity: 'up' },
      { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
    ],
    apply(ctx, t, tTrigger, values) {
      const force = values['force'] as number;
      if (force === 0) return;
      if (t < tTrigger || t >= tTrigger + (values['duration'] as number)) return;
      const rt = runtimeOf(ctx);
      const angle = values['angle'] as number;
      const o = 6 * rt.bobId;
      rt.xfrc[o] = force * Math.cos(angle);
      rt.xfrc[o + 1] = force * Math.sin(angle);
    },
    visual: (values) => ({ force: [values['force'] ?? 0, 0, 0], at: 'bob' }),
  };
}

export const testApp: RobotApp = {
  id: 'test',
  name: 'Sim test pendulum and box',
  files: async () => ({ 'scene.xml': new TextEncoder().encode(SCENE_XML) }),
  sceneFile: 'scene.xml',
  simDt: 0.002,
  controlDt: 0.02,
  warmup: 0.2,
  names: { body: ['box', 'bob'], joint: ['hinge'], actuator: ['drive'] },
  lexicon: { robotNames: ['robot'], predicates: [], perturbations: [makePushTemplate()] },
  initState(ctx, rng) {
    const rt = runtimeOf(ctx);
    rt.qpos[rt.hingeAdr] = (rng() * 2 - 1) * 0.1;
  },
  makeController(ctx): Controller {
    runtimeOf(ctx);
    return {
      step(c: SimContext): void {
        const rt = runtimeOf(c);
        const u = -KP * (rt.qpos[rt.hingeAdr] as number) - KD * (rt.qvel[rt.hingeDof] as number);
        rt.ctrl[rt.driveId] = u > TORQUE_LIMIT ? TORQUE_LIMIT : u < -TORQUE_LIMIT ? -TORQUE_LIMIT : u;
      },
    };
  },
  signals(ctx, out) {
    const rt = runtimeOf(ctx);
    out['box.z'] = rt.xpos[3 * rt.boxId + 2] as number;
    out['bob.angle'] = rt.qpos[rt.hingeAdr] as number;
    out['bob.speed'] = rt.qvel[rt.hingeDof] as number;
  },
};

// ------------------------------------------------------------------ requirement fixtures

export type TestKind = 'always-bob-angle' | 'eventually-bob-slow';
export interface TestRequirement extends CompiledRequirement { kind: TestKind; bound: number; formula: string }

/** Robustness of the fixture requirement over the first `n` samples. */
function evaluate(kind: TestKind, bound: number, t: Float64Array, sig: Record<string, Float64Array>, n: number) {
  if (kind === 'always-bob-angle') {
    const a = sig['bob.angle'] as Float64Array;
    let worst = Infinity; let at = t[0] as number;
    for (let k = 0; k < n; k++) {
      const m = bound - Math.abs(a[k] as number);
      if (m < worst) { worst = m; at = t[k] as number; }
    }
    return { robustness: worst, worstAt: at, unit: 'rad' };
  }
  const s = sig['bob.speed'] as Float64Array;
  let best = -Infinity; let at = t[0] as number;
  for (let k = 0; k < n; k++) {
    const m = bound - Math.abs(s[k] as number);
    if (m > best) { best = m; at = t[k] as number; }
  }
  return { robustness: best, worstAt: at, unit: 'rad/s' };
}

export const pushCall = (duration = 0.2): PerturbationCall => ({
  template: 'push', params: { force: 'push.force', duration, angle: 'push.angle' },
});

export function makeTestRequirement(opts: {
  horizon: number;
  kind?: TestKind;
  bound?: number;
  perturbations?: PerturbationCall[];
  id?: string;
  maxForce?: number;
}): TestRequirement {
  const kind = opts.kind ?? 'always-bob-angle';
  const bound = opts.bound ?? (kind === 'always-bob-angle' ? 0.3 : 0.5);
  return {
    id: opts.id ?? 'R1',
    source: `WHEN the bob is pushed THE robot SHALL ${kind}`,
    pattern: 'event',
    space: {
      dims: [
        { name: 'push.force', kind: 'force', min: 0, max: opts.maxForce ?? DEFAULT_MAX_FORCE, severity: 'up' },
        { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
      ],
    },
    perturbations: opts.perturbations ?? [pushCall()],
    horizon: opts.horizon,
    formula: `test(${kind}, ${bound})`,
    kind,
    bound,
    monitor: (trace: Trace) => evaluate(kind, bound, trace.t, trace.signals, trace.t.length),
  };
}

function makeHook(req: TestRequirement, decide: (r: number) => boolean): EarlyStopHook {
  return (trace, n) => {
    const r = evaluate(req.kind, req.bound, trace.t, trace.signals, n).robustness;
    return decide(r) ? r : undefined;
  };
}

/** Decided violation as soon as the prefix margin is negative (an `always` margin never recovers). */
export function makeAlwaysHook(req: TestRequirement): EarlyStopHook {
  return makeHook(req, (r) => r < 0);
}

/** Decided satisfaction as soon as the prefix margin is positive (an `eventually` margin never drops). */
export function makeEventuallyHook(req: TestRequirement): EarlyStopHook {
  return makeHook(req, (r) => r > 0);
}
