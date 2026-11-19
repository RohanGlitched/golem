// The Stagger RobotApp: a Unitree G1 (12-DOF legs) walking under Unitree's published policy.
import type { RobotApp, SimContext } from './contract.js';
import { DEFAULT_POSE } from './controller/observation.js';
import { Policy } from './controller/policy.js';
import { Walker } from './controller/walker.js';
import { lexicon } from './lexicon.js';
import { FLOOR_GEOM, PUSH_BODY, pendingRestore, restoreLeftovers, restoreModel } from './perturbations.js';
import { WARMUP, resetRuntime, runtimeFor } from './runtime.js';
import { writeSignals } from './signals.js';

/** Standing pose of the free joint: the pelvis body position of the upstream MJCF, upright, at rest. */
export const STANDING_POS: readonly [number, number, number] = [0, 0, 0.793];
export const INIT_NOISE_STD = 0.01;   // rad
export const LEG_JOINTS = 12;

// ---------------------------------------------------------------- files

/** Files that the asset pipeline generates and that SOURCE.json may not list. */
const GENERATED = ['scene.xml', 'policy.bin', 'SOURCE.json'];

let robotBase: URL = new URL('./robot/', import.meta.url);
let cached: Promise<Record<string, Uint8Array>> | undefined;

/** Where `files()` reads robot/ from. The studio page sets this to a URL on its own origin. */
export function setRobotBase(base: string | URL): void {
  robotBase = new URL(base);
  cached = undefined;
}

const isNode = (): boolean =>
  typeof process !== 'undefined' && typeof process.versions === 'object' && typeof process.versions.node === 'string'
  && robotBase.protocol === 'file:';

async function readOne(path: string): Promise<Uint8Array> {
  const url = new URL(path, robotBase);
  if (isNode()) {
    const { readFile } = await import('node:fs/promises');
    try {
      return new Uint8Array(await readFile(url));
    } catch (e) {
      throw new Error(`robot file ${path} could not be read: ${(e as Error).message}`);
    }
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`robot file ${path} could not be fetched: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`robot file ${path} could not be fetched: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Lists robot/ from SOURCE.json (every `local` entry) plus the generated files. */
export function robotFileList(sourceJson: Uint8Array): string[] {
  const src = JSON.parse(new TextDecoder().decode(sourceJson)) as { files: { local: string }[] };
  const list = new Set<string>(GENERATED);
  for (const f of src.files) list.add(f.local);
  return [...list].sort();
}

async function loadFiles(): Promise<Record<string, Uint8Array>> {
  const source = await readOne('SOURCE.json');
  const out: Record<string, Uint8Array> = {};
  for (const path of robotFileList(source)) out[path] = path === 'SOURCE.json' ? source : await readOne(path);
  return out;
}

// ---------------------------------------------------------------- state

/** One standard normal pair per two rng() draws (Box-Muller), written to out[i], out[i + 1]. */
export function normalPair(rng: () => number, out: Float64Array, i: number): void {
  const u1 = 1 - rng();          // (0, 1]: log stays finite
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  out[i] = r * Math.cos(2 * Math.PI * u2);
  if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
}

/** Draws the 12 leg-joint noise values (rad), in joint order, from 6 Box-Muller pairs. */
export function drawJointNoise(rng: () => number, out: Float64Array = new Float64Array(LEG_JOINTS)): Float64Array {
  for (let i = 0; i < LEG_JOINTS; i += 2) normalPair(rng, out, i);
  for (let i = 0; i < LEG_JOINTS; i++) out[i] = INIT_NOISE_STD * (out[i] as number);
  return out;
}

/** Free joint at the standing pose, legs at Default_Pose + noise, every velocity zero. */
export function setStandingPose(ctx: SimContext, noise: ArrayLike<number>): void {
  const qpos: Float64Array = ctx.data.qpos;
  const qvel: Float64Array = ctx.data.qvel;
  qpos[0] = STANDING_POS[0]; qpos[1] = STANDING_POS[1]; qpos[2] = STANDING_POS[2];
  qpos[3] = 1; qpos[4] = 0; qpos[5] = 0; qpos[6] = 0;
  for (let j = 0; j < LEG_JOINTS; j++) qpos[7 + j] = (DEFAULT_POSE[j] as number) + (noise[j] as number);
  qvel.fill(0);
}

let policyBytes: Uint8Array | undefined;

/** Loads the policy from the files() bytes, or from the MuJoCo FS where golem-sim wrote robot/. */
function policyFor(ctx: SimContext): Policy {
  const bytes = policyBytes ?? (ctx.mj.FS.readFile('/robot/policy.bin') as Uint8Array);
  return Policy.fromBytes(bytes);
}

// ---------------------------------------------------------------- the app

export const stagger: RobotApp = {
  id: 'stagger',
  name: 'Stagger: Unitree G1',
  sceneFile: 'scene.xml',
  simDt: 0.002,
  controlDt: 0.02,
  warmup: WARMUP,
  lexicon,
  names: { body: [PUSH_BODY], geom: [FLOOR_GEOM] },

  async files() {
    cached ??= loadFiles();
    const p = cached;
    try {
      const files = await p;
      policyBytes = files['policy.bin'];
      return { ...files };
    } catch (e) {
      if (cached === p) cached = undefined;
      throw e;
    }
  },

  makeController(ctx) {
    return new Walker(ctx, policyFor(ctx), runtimeFor(ctx));
  },

  initState(ctx, rng) {
    restoreLeftovers(ctx);
    const rt = runtimeFor(ctx);
    restoreModel(ctx, rt);
    resetRuntime(rt);
    const model = ctx.model;
    const autoreset: number = ctx.mj.mjtDisableBit.mjDSBL_AUTORESET.value;
    if ((model.opt.disableflags & autoreset) === 0) model.opt.disableflags = model.opt.disableflags | autoreset;
    setStandingPose(ctx, drawJointNoise(rng, rt.noise));
  },

  signals(ctx, out) {
    writeSignals(ctx, runtimeFor(ctx), out);
  },

  endTrial(ctx) {
    const rt = runtimeFor(ctx);
    restoreModel(ctx, rt);
    if (pendingRestore.get(ctx.model) === rt) pendingRestore.delete(ctx.model);
  },
};

export { setReflex, currentReflex } from './controller/walker.js';
export type { ReflexKind } from './controller/walker.js';
export default stagger;
