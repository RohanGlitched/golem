// The Candy RobotApp: a Franka Panda with a suction cup sorts six pieces of Halloween candy into three bowls while a
// hand may reach into the workspace. Runs unchanged in Node and in the browser; only `files()` branches on the runtime.
import {
  CANDY_COUNT, CANDY_HALF_HEIGHT, CANDY_SPAWN, CONTROL_DT, PARK, Q_HOME, SIM_DT, UD, WARMUP,
} from './constants';
import type { RobotApp, SimContext } from './contract';
import { CandyController } from './controller';
import { CANDY_NAMES, candyIds } from './controller/ids';
import { resolveOverlaps } from './geometry';
import { lexicon } from './lexicon';
import { writeSignals } from './signals';

// ---------------------------------------------------------------- files

export const MISSING_ASSETS = 'Assets are missing from robot/: run node scripts/fetch-assets.mjs.';

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
    return new Uint8Array(await readFile(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Lists robot/ from the manifest that the asset script writes: every output, plus SOURCE.json itself. */
export function robotFileList(sourceJson: Uint8Array): string[] {
  const manifest = JSON.parse(new TextDecoder().decode(sourceJson)) as { outputs: Record<string, string> };
  return [...Object.keys(manifest.outputs), 'SOURCE.json'].sort();
}

async function loadFiles(): Promise<Record<string, Uint8Array>> {
  let source: Uint8Array;
  try {
    source = await readOne('SOURCE.json');
  } catch (e) {
    throw new Error(MISSING_ASSETS, { cause: e });
  }
  const out: Record<string, Uint8Array> = {};
  try {
    // in parallel: on a CDN cache miss each file is a round trip to the origin, so a serial loop took ~45 s
    const paths = robotFileList(source);
    const settled = await Promise.allSettled(paths.map((path) => (path === 'SOURCE.json' ? Promise.resolve(source) : readOne(path))));
    // wait for every read, then report the first failure in file order (deterministic, and no read left open)
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const bytes = settled.map((r) => (r as PromiseFulfilledResult<Uint8Array>).value);
    paths.forEach((path, i) => { out[path] = bytes[i]!; });
  } catch (e) {
    throw new Error(MISSING_ASSETS, { cause: e });
  }
  return out;
}

// ---------------------------------------------------------------- state

/** Candy controllers by context, so that endTrial can dispose the one of the trial that ends. */
const controllers = new WeakMap<SimContext, CandyController>();

/** Number of PRNG draws that initState makes: x, y and colour for each of the six candies. */
export const INIT_DRAWS = 3 * CANDY_COUNT;

/** Parks candies of index `count` and above on the floor, out of the way: they take no part in a trial. */
export function parkInactive(ctx: SimContext): void {
  const ids = candyIds(ctx);
  const qpos: Float64Array = ctx.data.qpos;
  const qvel: Float64Array = ctx.data.qvel;
  const count = Math.round((ctx.data.userdata as Float64Array)[UD.count] as number);
  for (let i = Math.max(0, count); i < CANDY_COUNT; i++) {
    const q = ids.candyQpos[i] as number, d = ids.candyDof[i] as number;
    qpos[q] = PARK.x + PARK.dx * i; qpos[q + 1] = PARK.y; qpos[q + 2] = PARK.z;
    qpos[q + 3] = 1; qpos[q + 4] = 0; qpos[q + 5] = 0; qpos[q + 6] = 0;
    for (let k = 0; k < 6; k++) qvel[d + k] = 0;
  }
}

export const candy: RobotApp = {
  id: 'candy',
  name: 'Candy sorter (Franka Panda)',
  sceneFile: 'scene.xml',
  simDt: SIM_DT,
  controlDt: CONTROL_DT,
  warmup: WARMUP,
  lexicon,
  names: CANDY_NAMES as unknown as NonNullable<RobotApp['names']>,

  async files() {
    cached ??= loadFiles();
    const p = cached;
    try {
      return { ...(await p) };
    } catch (e) {
      if (cached === p) cached = undefined;
      throw e;
    }
  },

  makeController(ctx, rng) {
    const c = new CandyController(ctx, rng);
    controllers.set(ctx, c);
    return c;
  },

  /**
   * The Panda at the Home_Pose, the defaults in userdata (Vacuum_Ratio 1, Tracker_Lag 0 s, six candies), then for
   * candies 0 to 5 three draws each, in this order: x, y, colour. 18 draws in total. The overlap rule shifts later
   * candies along +x.
   */
  initState(ctx, rng) {
    const ids = candyIds(ctx);
    const data = ctx.data;
    const qpos: Float64Array = data.qpos;
    const qvel: Float64Array = data.qvel;
    const ctrl: Float64Array = data.ctrl;
    const ud: Float64Array = data.userdata;
    qvel.fill(0);
    for (let j = 0; j < 7; j++) {
      qpos[ids.jointQpos[j] as number] = Q_HOME[j] as number;
      ctrl[ids.actuator[j] as number] = Q_HOME[j] as number;
    }
    ud.fill(0);
    ud[UD.vacuum] = 1; ud[UD.lag] = 0; ud[UD.count] = CANDY_COUNT; ud[UD.target] = -1;

    const xy = new Float64Array(2 * CANDY_COUNT);
    for (let i = 0; i < CANDY_COUNT; i++) {
      const ux = rng(), uy = rng(), uc = rng();
      xy[2 * i] = CANDY_SPAWN.xMin + (CANDY_SPAWN.xMax - CANDY_SPAWN.xMin) * ux;
      xy[2 * i + 1] = CANDY_SPAWN.yMin + (CANDY_SPAWN.yMax - CANDY_SPAWN.yMin) * uy;
      ud[UD.colour + i] = Math.min(2, Math.floor(3 * uc));
    }
    resolveOverlaps(xy);
    for (let i = 0; i < CANDY_COUNT; i++) {
      const q = ids.candyQpos[i] as number;
      qpos[q] = xy[2 * i] as number; qpos[q + 1] = xy[2 * i + 1] as number; qpos[q + 2] = CANDY_HALF_HEIGHT[i] as number;
      qpos[q + 3] = 1; qpos[q + 4] = 0; qpos[q + 5] = 0; qpos[q + 6] = 0;
    }
    parkInactive(ctx);
  },

  signals(ctx, out) {
    writeSignals(ctx, out);
  },

  endTrial(ctx) {
    const c = controllers.get(ctx);
    if (c !== undefined) { controllers.delete(ctx); c.dispose(); }
  },
};

export default candy;
