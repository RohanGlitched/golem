// Contact-rich test models for the runner tests. Test-only, not exported from index.ts.
// boxDropApp: boxes dropped on a plane (contacts from the first warm-up steps).
// stoolApp: a torso on four hinged legs held by PD control, plus a free crate on the floor.
import { createSaturationMeter } from './helpers.js';
import type {
  CompiledRequirement, Controller, Dimension, PerturbationCall, PerturbationTemplate, RobotApp, SimContext, Trace,
} from './types.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// ---------------------------------------------------------------- templates shared by both apps

/** Vertical force `force` (N) on body `bodyKey` (an ids key) during [trigger + delay, trigger + delay + duration). */
export function kickTemplate(bodyKey: string): PerturbationTemplate {
  return {
    phrase: 'the body is kicked upwards with {force} for {duration}',
    name: 'kick',
    dims: () => [],
    apply(ctx, t, tTrigger, values) {
      const t0 = tTrigger + (values['delay'] ?? 0);
      if (t < t0 || t >= t0 + (values['duration'] as number)) return;
      const id = ctx.ids[bodyKey] as number;
      (ctx.data.xfrc_applied as Float64Array)[6 * id + 2] = values['force'] as number;
    },
  };
}

/** Horizontal force `force` (N) at `angle` (rad) on body `bodyKey` during [trigger, trigger + duration). */
export function shoveTemplate(bodyKey: string): PerturbationTemplate {
  return {
    phrase: 'the body is shoved with {range:force} for {duration} from {direction}',
    name: 'shove',
    dims: () => [],
    apply(ctx, t, tTrigger, values) {
      if (t < tTrigger || t >= tTrigger + (values['duration'] as number)) return;
      const id = ctx.ids[bodyKey] as number;
      const f = values['force'] as number;
      const a = values['angle'] as number;
      const x = ctx.data.xfrc_applied as Float64Array;
      x[6 * id] = f * Math.cos(a);
      x[6 * id + 1] = f * Math.sin(a);
    },
  };
}

export const FORCE_DIM: Dimension = { name: 'f', kind: 'force', min: 0, max: 1e31, severity: 'up' };
export const ANGLE_DIM: Dimension = { name: 'a', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true };

export const kickCall = (duration = 0.02, delay = 0): PerturbationCall => ({
  template: 'kick', params: { force: 'f', duration, delay },
});
export const shoveCall = (duration = 0.1): PerturbationCall => ({
  template: 'shove', params: { force: 'f', angle: 'a', duration },
});

/**
 * `always signal >= bound` over the trace (robustness = min(signal - bound), unit m).
 * The space always has the dims `f` (force) and `a` (angle).
 */
export function alwaysAbove(opts: {
  signal: string; bound: number; horizon: number; perturbations?: PerturbationCall[]; id?: string; unit?: string;
}): CompiledRequirement {
  const { signal, bound } = opts;
  return {
    id: opts.id ?? 'R1',
    source: `THE robot SHALL keep ${signal} above ${bound} m`,
    pattern: 'event',
    space: { dims: [FORCE_DIM, ANGLE_DIM] },
    perturbations: opts.perturbations ?? [],
    horizon: opts.horizon,
    monitor(trace: Trace) {
      const s = trace.signals[signal];
      let worst = Infinity;
      let at = trace.t[0] ?? 0;
      if (s !== undefined) {
        for (let k = 0; k < s.length; k++) {
          const m = (s[k] as number) - bound;
          if (!(m >= worst)) { worst = m; at = trace.t[k] as number; }
        }
      }
      return { robustness: worst, worstAt: at, unit: opts.unit ?? 'm' };
    },
  };
}

// ---------------------------------------------------------------- box drop

const BOX_XML = `<mujoco model="golem-box-drop">
  <compiler angle="radian"/>
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <body name="box" pos="0 0 0.3">
      <freejoint name="box_free"/>
      <geom name="box" type="box" size="0.1 0.1 0.1" mass="1"/>
      <site name="box_site" pos="0 0 0"/>
    </body>
    <body name="box2" pos="0.5 0 0.12" euler="0 0 0.3">
      <freejoint name="box2_free"/>
      <geom name="box2" type="box" size="0.1 0.1 0.1" mass="1"/>
    </body>
    <body name="box3" pos="0.5 0 0.4">
      <freejoint name="box3_free"/>
      <geom name="box3" type="box" size="0.08 0.08 0.08" mass="0.5"/>
    </body>
  </worldbody>
  <sensor>
    <framepos name="box_pos" objtype="site" objname="box_site"/>
  </sensor>
</mujoco>
`;

export const boxDropApp: RobotApp = {
  id: 'box-drop',
  name: 'Boxes dropped on a plane',
  files: async () => ({ 'scene.xml': enc(BOX_XML) }),
  sceneFile: 'scene.xml',
  simDt: 0.002,
  controlDt: 0.02,
  warmup: 0.2,
  names: { body: ['box', 'box2', 'box3'], site: ['box_site'] },
  lexicon: { robotNames: ['robot'], predicates: [], perturbations: [kickTemplate('body:box'), shoveTemplate('body:box')] },
  makeController: (): Controller => ({ step: () => {} }),
  signals(ctx, out) {
    out['box.z'] = (ctx.data.xpos as Float64Array)[3 * (ctx.ids['body:box'] as number) + 2] as number;
    out['contacts'] = ctx.data.ncon as number;
    out['time'] = ctx.data.time as number;
  },
};

// ---------------------------------------------------------------- stool (small legged model)

const LEGS = ['fl', 'fr', 'hl', 'hr'] as const;
const LEG_POS: Record<(typeof LEGS)[number], string> = {
  fl: '0.18 0.13 -0.03', fr: '0.18 -0.13 -0.03', hl: '-0.18 0.13 -0.03', hr: '-0.18 -0.13 -0.03',
};
const STOOL_XML = `<mujoco model="golem-stool">
  <compiler angle="radian"/>
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1" friction="0.15 0.005 0.0001"/>
    <body name="crate" pos="1 0 0.1">
      <freejoint name="crate_free"/>
      <geom name="crate" type="box" size="0.1 0.1 0.1" mass="1"/>
    </body>
    <body name="torso" pos="0 0 0.3">
      <freejoint name="root"/>
      <geom name="torso" type="box" size="0.2 0.15 0.03" mass="3"/>
      <site name="imu" pos="0 0 0"/>
${LEGS.map((l) => `      <body name="leg_${l}" pos="${LEG_POS[l]}">
        <joint name="hip_${l}" type="hinge" axis="0 1 0" range="-1.2 1.2" damping="0.05" armature="0.01"/>
        <geom name="foot_${l}" type="capsule" fromto="0 0 0 0 0 -0.28" size="0.02" mass="0.2" friction="0.15 0.005 0.0001"/>
      </body>`).join('\n')}
    </body>
  </worldbody>
  <equality>
    <weld name="harness" body1="torso" active="false"/>
  </equality>
  <actuator>
${LEGS.map((l) => `    <motor name="m_${l}" joint="hip_${l}" ctrlrange="-8 8" ctrllimited="true"/>`).join('\n')}
  </actuator>
  <sensor>
    <framepos name="imu_pos" objtype="site" objname="imu"/>
  </sensor>
</mujoco>
`;

/** Default hip angles (rad): front legs splay forward, hind legs backward. */
export const STOOL_DEFAULT: Record<(typeof LEGS)[number], number> = { fl: -0.5, fr: -0.5, hl: 0.5, hr: 0.5 };
export const STOOL_KP = 60;
export const STOOL_KD = 1.5;

/** Per-trial stool runtime: joint addresses and the policy's target angles. */
interface StoolRt {
  qadr: number[]; dadr: number[]; act: number[]; target: Float64Array; saturation: (ctrl: ArrayLike<number>) => number;
}
const STOOL_RT = new WeakMap<SimContext, StoolRt>();
export function stoolRuntime(ctx: SimContext): StoolRt {
  let rt = STOOL_RT.get(ctx);
  if (rt === undefined) {
    const m = ctx.model;
    const joints = LEGS.map((l) => ctx.ids[`joint:hip_${l}`] as number);
    rt = {
      qadr: joints.map((j) => m.jnt_qposadr[j] as number),
      dadr: joints.map((j) => m.jnt_dofadr[j] as number),
      act: LEGS.map((l) => ctx.ids[`actuator:m_${l}`] as number),
      target: new Float64Array(LEGS.length),
      saturation: createSaturationMeter(m),
    };
    STOOL_RT.set(ctx, rt);
  }
  return rt;
}

/** Writes PD torques for the current targets into ctrl. */
export function stoolPd(ctx: SimContext): void {
  const rt = stoolRuntime(ctx);
  const q = ctx.data.qpos as Float64Array, v = ctx.data.qvel as Float64Array, u = ctx.data.ctrl as Float64Array;
  for (let i = 0; i < rt.qadr.length; i++) {
    u[rt.act[i] as number] = STOOL_KP * ((rt.target[i] as number) - (q[rt.qadr[i] as number] as number))
      - STOOL_KD * (v[rt.dadr[i] as number] as number);
  }
}

/**
 * pd: where the PD loop runs. 'substep' = 500 Hz under a 50 Hz policy (the Unitree split),
 * 'step' = once per control step (zero-order hold), 'none' = no torque at all.
 */
export function makeStoolApp(pd: 'substep' | 'step' | 'none' = 'substep'): RobotApp {
  return {
    id: 'stool',
    name: 'Four-legged stool',
    files: async () => ({ 'scene.xml': enc(STOOL_XML) }),
    sceneFile: 'scene.xml',
    simDt: 0.002,
    controlDt: 0.02,
    warmup: 0.2,
    names: {
      body: ['torso', 'crate'], site: ['imu'],
      joint: LEGS.map((l) => `hip_${l}`), actuator: LEGS.map((l) => `m_${l}`),
    },
    lexicon: { robotNames: ['robot'], predicates: [], perturbations: [kickTemplate('body:torso'), shoveTemplate('body:torso')] },
    initState(ctx, rng) {
      const rt = stoolRuntime(ctx);
      const q = ctx.data.qpos as Float64Array;
      rt.qadr.forEach((a, i) => { q[a] = (STOOL_DEFAULT[LEGS[i] as (typeof LEGS)[number]]) + (rng() * 2 - 1) * 0.05; });
    },
    makeController(ctx): Controller {
      stoolRuntime(ctx);
      const c: Controller = {
        // The 50 Hz "policy": hold the default pose.
        step(cc) {
          const target = stoolRuntime(cc).target;
          LEGS.forEach((l, i) => { target[i] = STOOL_DEFAULT[l]; });
          if (pd === 'step') stoolPd(cc);
        },
      };
      if (pd === 'substep') c.substep = (cc) => stoolPd(cc);
      return c;
    },
    signals(ctx, out) {
      out['torso.z'] = (ctx.data.xpos as Float64Array)[3 * (ctx.ids['body:torso'] as number) + 2] as number;
      out['contacts'] = ctx.data.ncon as number;
      out['saturation'] = stoolRuntime(ctx).saturation(ctx.data.ctrl as Float64Array);
    },
  };
}

export const stoolApp: RobotApp = makeStoolApp('substep');
export const STOOL_LEGS = LEGS;
