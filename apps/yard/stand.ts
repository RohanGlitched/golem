// The yard: one RobotApp for any MuJoCo Menagerie robot that has position servos. The robot stands in its keyframe pose
// (or the model's rest pose when it has none) and holds it with its own servos at their stock gains: the controller only
// writes the pose's targets. There is no balance controller, so the yard measures the stance that ships with the model,
// not the robot's real controller. Runs unchanged in Node and in the browser; only `files()` branches on the runtime.
import meta from './robots.json';
import type { Controller, Lexicon, PerturbationTemplate, PredicateTemplate, RobotApp, SimContext } from './contract';

export interface YardRobot {
  id: string; name: string; kind: 'quadruped' | 'humanoid'; folder: string; model: string;
  /** Keyframe to stand in; null when the model has none (the rest pose qpos0 is used). */
  key: string | null;
  /** The body with the free joint: pushes act on it and the signals read it. */
  base: string;
}

export const ROBOTS = meta.robots as YardRobot[];
export const COMMIT = meta.commit;

/** Sim timestep (s); scripts/fetch-assets.mjs writes the same value into every scene.xml. */
export const SIM_DT = 0.002;
/** Control period (s). The controller writes the same targets every step, so this only sets the trace rate. */
export const CONTROL_DT = 0.01;
/** Seconds the robot stands untouched before the trigger, so it settles onto its feet. */
export const WARMUP = 1.5;
/** Episode length when a line has no `for` window (s). */
export const EPISODE_SECONDS = 5;
export const GRAVITY = 9.81;

/** `stay upright`: the base above this fraction of its standing height... */
export const UPRIGHT_HEIGHT_RATIO = 0.6;
/** ...and tilted less than this (deg). */
export const UPRIGHT_TILT_LIMIT = 45;
/** Converts tilt headroom to metres so both parts of the upright margin share one unit: 5 mm per degree (as the G1's). */
export const TILT_TO_M = 0.005;

const RAD2DEG = 180 / Math.PI;

export function robotById(id: string): YardRobot {
  const r = ROBOTS.find((x) => x.id === id);
  if (!r) throw new Error(`no yard robot "${id}"; known: ${ROBOTS.map((x) => x.id).join(', ')}`);
  return r;
}

// ---------------------------------------------------------------- runtime

interface Runtime {
  qpos: Float64Array; qvel: Float64Array; ctrl: Float64Array; xfrc: Float64Array; xquat: Float64Array;
  base: number;
  /** Weight of the whole robot (N): the subtree mass of the base times g. */
  weight: number;
  /** Base height in the standing pose (m). */
  standHeight: number;
  /** The servo targets of the standing pose. */
  targets: Float64Array;
  /** Where the base stood and which way it faced at the trigger; latched by the first push call. */
  latched: boolean; x0: number; y0: number; hx: number; hy: number;
}

const runtimes = new WeakMap<SimContext, Runtime>();

function runtimeFor(ctx: SimContext, robot: YardRobot): Runtime {
  let rt = runtimes.get(ctx);
  if (rt === undefined) {
    const base = ctx.ids[`body:${robot.base}`];
    if (base === undefined) throw new Error(`body "${robot.base}" is not resolved in ctx.ids`);
    const m = ctx.model;
    const k = keyIndex(ctx, robot);
    const nq: number = m.nq, nu: number = m.nu;
    const targets = new Float64Array(nu);
    const keyCtrl: Float64Array | undefined = k >= 0 ? m.key_ctrl.subarray(k * nu, (k + 1) * nu) : undefined;
    const pose: Float64Array = k >= 0 ? m.key_qpos.subarray(k * nq, (k + 1) * nq) : m.qpos0;
    const trnid: Int32Array = m.actuator_trnid, qadr: Int32Array = m.jnt_qposadr;
    for (let a = 0; a < nu; a++) {
      const fromKey = keyCtrl?.[a];
      targets[a] = keyCtrl !== undefined && keyCtrl.some((v) => v !== 0) ? (fromKey as number) : (pose[qadr[trnid[2 * a] as number] as number] as number);
    }
    rt = {
      qpos: ctx.data.qpos, qvel: ctx.data.qvel, ctrl: ctx.data.ctrl, xfrc: ctx.data.xfrc_applied, xquat: ctx.data.xquat,
      base, weight: (m.body_subtreemass[base] as number) * GRAVITY, standHeight: pose[2] as number, targets,
      latched: false, x0: 0, y0: 0, hx: 1, hy: 0,
    };
    runtimes.set(ctx, rt);
  } else if (rt.qpos.buffer.byteLength === 0 || rt.xfrc.buffer.byteLength === 0) {
    const d = ctx.data;
    rt.qpos = d.qpos; rt.qvel = d.qvel; rt.ctrl = d.ctrl; rt.xfrc = d.xfrc_applied; rt.xquat = d.xquat;
  }
  return rt;
}

function keyIndex(ctx: SimContext, robot: YardRobot): number {
  if (robot.key === null || !(ctx.model.nkey > 0)) return -1;
  const id = ctx.mj.mj_name2id(ctx.model, ctx.mj.mjtObj.mjOBJ_KEY.value, robot.key);
  if (!(id >= 0)) throw new Error(`keyframe "${robot.key}" is not in the model of ${robot.name}`);
  return id;
}

// ---------------------------------------------------------------- signals

export const SIGNAL_NAMES = ['base_height_ratio', 'tilt_deg', 'drift'] as const;

/** Angle between the body z axis and world up, in degrees. Quaternion (w, x, y, z) at `o`. */
export function tiltDeg(q: ArrayLike<number>, o = 0): number {
  const w = q[o] as number, x = q[o + 1] as number, y = q[o + 2] as number, z = q[o + 3] as number;
  const n2 = w * w + x * x + y * y + z * z;
  if (!(n2 > 0)) return Number.NaN;
  let c = 1 - (2 * (x * x + y * y)) / n2;
  if (c > 1) c = 1; else if (c < -1) c = -1;
  return Math.acos(c) * RAD2DEG;
}

/** Heading of a body (unit x axis projected on the floor), from its quaternion (w, x, y, z) at `o`, into out[0..1]. */
export function headingOf(q: ArrayLike<number>, o: number, out: Float64Array): void {
  const w = q[o] as number, x = q[o + 1] as number, y = q[o + 2] as number, z = q[o + 3] as number;
  const hx = 1 - 2 * (y * y + z * z), hy = 2 * (x * y + w * z);
  const n = Math.hypot(hx, hy);
  if (n > 1e-9) { out[0] = hx / n; out[1] = hy / n; } else { out[0] = 1; out[1] = 0; }
}

// ---------------------------------------------------------------- predicates

/** `stay upright`: min(base height - 60% of the standing height, (45 deg - tilt) x 5 mm/deg), in m. */
export function uprightMargin(heightRatio: number, tilt: number, standHeight: number): number {
  if (!Number.isFinite(heightRatio) || !Number.isFinite(tilt)) return -Infinity;
  return Math.min((heightRatio - UPRIGHT_HEIGHT_RATIO) * standHeight, (UPRIGHT_TILT_LIMIT - tilt) * TILT_TO_M);
}

// ---------------------------------------------------------------- perturbations

const scratch = new Float64Array(2);

/** The world-frame push direction for a push from `angle` (rad, counterclockwise from the robot's front), into out. */
export function pushDirection(angle: number, hx: number, hy: number, out: Float64Array): void {
  const c = -Math.cos(angle), s = -Math.sin(angle);
  out[0] = c * hx - s * hy;
  out[1] = s * hx + c * hy;
}

// ---------------------------------------------------------------- files

export const MISSING_ASSETS = (id: string): string => `Assets are missing: run node apps/yard/scripts/fetch-assets.mjs ${id}.`;

/** Lists robot/ from the manifest that the asset script writes: every output, plus SOURCE.json itself. */
export function robotFileList(sourceJson: Uint8Array): string[] {
  const manifest = JSON.parse(new TextDecoder().decode(sourceJson)) as { outputs: Record<string, string> };
  return [...Object.keys(manifest.outputs), 'SOURCE.json'].sort();
}

function fileLoader(id: string, base: () => URL): () => Promise<Record<string, Uint8Array>> {
  let cached: Promise<Record<string, Uint8Array>> | undefined;
  const isNode = (): boolean => typeof process !== 'undefined' && typeof process.versions?.node === 'string' && base().protocol === 'file:';
  const readOne = async (path: string): Promise<Uint8Array> => {
    const url = new URL(path, base());
    if (isNode()) return new Uint8Array(await (await import('node:fs/promises')).readFile(url));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const load = async (): Promise<Record<string, Uint8Array>> => {
    try {
      const source = await readOne('SOURCE.json');
      const paths = robotFileList(source);
      const bytes = await Promise.all(paths.map((p) => (p === 'SOURCE.json' ? source : readOne(p))));
      return Object.fromEntries(paths.map((p, i) => [p, bytes[i] as Uint8Array]));
    } catch (e) {
      throw new Error(MISSING_ASSETS(id), { cause: e });
    }
  };
  return async () => {
    cached ??= load();
    const p = cached;
    try { return { ...(await p) }; } catch (e) { if (cached === p) cached = undefined; throw e; }
  };
}

// ---------------------------------------------------------------- the app

export interface StandApp extends RobotApp {
  robot: YardRobot;
  /** Where `files()` reads robot/ from. The studio page sets this to a URL on its own origin. */
  setRobotBase(base: string | URL): void;
}

/**
 * The yard app for one robot. `robotDir` is the robot's robot/ folder (a file: URL in Node, set to an http URL by the
 * studio page). Zero PRNG draws: every trial starts in the same pose, and the search varies only the push.
 */
export function standApp(id: string, robotDir: URL): StandApp {
  const robot = robotById(id);
  let base = robotDir;

  const predicates: PredicateTemplate[] = [
    {
      phrase: 'stay upright',
      signals: ['base_height_ratio', 'tilt_deg', 'stand_height'],
      unit: 'm',
      margin: (s) => uprightMargin(s['base_height_ratio'] as number, s['tilt_deg'] as number, s['stand_height'] as number),
    },
    {
      phrase: 'not move more than {length} from where it stood',
      signals: ['drift'],
      unit: 'm',
      margin: (s, slots) => {
        const d = s['drift'] as number, l = slots['length'] as number;
        return Number.isFinite(d) && Number.isFinite(l) ? l - d : -Infinity;
      },
    },
  ];

  const push: PerturbationTemplate = {
    phrase: 'the base is pushed with {range:ratio} of its weight for {duration} from {direction}',
    slots: { ratio: { dim: 'push.weight', severity: 'up' }, direction: { dim: 'push.angle', severity: 'none' } },
    apply(ctx, t, tTrigger, values) {
      const rt = runtimeFor(ctx, robot);
      if (!rt.latched) {
        const b = rt.base;
        scratch[0] = 1; scratch[1] = 0;
        headingOf(rt.xquat, 4 * b, scratch);
        rt.hx = scratch[0] as number; rt.hy = scratch[1] as number;
        rt.latched = true;
      }
      const dt = t - tTrigger;
      if (!(dt >= 0 && dt < (values['duration'] ?? 0))) return;
      pushDirection(values['direction'] ?? 0, rt.hx, rt.hy, scratch);
      const f = (values['ratio'] ?? 0) * rt.weight;
      const r = 6 * rt.base;
      rt.xfrc[r] = f * (scratch[0] as number);
      rt.xfrc[r + 1] = f * (scratch[1] as number);
      rt.xfrc[r + 2] = 0; rt.xfrc[r + 3] = 0; rt.xfrc[r + 4] = 0; rt.xfrc[r + 5] = 0;
    },
    visual(values) {
      const a = values['direction'] ?? 0, f = values['ratio'] ?? 0;
      return { force: [-f * Math.cos(a), -f * Math.sin(a), 0], at: robot.base };
    },
  };

  const lexicon = {
    robotNames: ['robot', robot.kind, ...robot.name.split(/\s+/).filter((w) => /^[A-Za-z][\w-]*$/.test(w))],
    predicates,
    perturbations: [push],
    episodeSeconds: EPISODE_SECONDS,
  } as unknown as Lexicon;

  const load = fileLoader(robot.id, () => base);

  const app: StandApp = {
    id: `yard-${robot.id}`,
    name: `${robot.name} (yard)`,
    robot,
    sceneFile: 'scene.xml',
    simDt: SIM_DT,
    controlDt: CONTROL_DT,
    warmup: WARMUP,
    lexicon,
    names: { body: [robot.base] },
    setRobotBase(b) { base = new URL(b); },
    files: () => load(),

    initState(ctx) {
      const k = keyIndex(ctx, robot);
      const m = ctx.model, d = ctx.data;
      const nq: number = m.nq;
      const qpos: Float64Array = d.qpos;
      qpos.set(k >= 0 ? m.key_qpos.subarray(k * nq, (k + 1) * nq) : m.qpos0);
      (d.qvel as Float64Array).fill(0);
      (d.ctrl as Float64Array).set(runtimeFor(ctx, robot).targets);
    },

    makeController(ctx): Controller {
      const rt = runtimeFor(ctx, robot);
      return { step() { rt.ctrl.set(rt.targets); } };
    },

    signals(ctx, out) {
      const rt = runtimeFor(ctx, robot);
      const q = rt.qpos;
      if (!rt.latched) { rt.x0 = q[0] as number; rt.y0 = q[1] as number; }
      out['stand_height'] = rt.standHeight;
      out['base_height_ratio'] = (q[2] as number) / rt.standHeight;
      out['tilt_deg'] = tiltDeg(q, 3);
      out['drift'] = rt.latched ? Math.hypot((q[0] as number) - rt.x0, (q[1] as number) - rt.y0) : 0;
    },
  };
  return app;
}
