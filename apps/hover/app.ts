// The Hover RobotApp: a Skydio X2 quadrotor holds a hover point at 1.0 m while gusts, a sagging battery and a lagging
// position estimate act on it. Runs unchanged in Node and in the browser; only `files()` branches on the runtime.
import { CONTROL_DT, HOVER_NAMES, HOVER_POINT, SIM_DT, START_OFFSET, WARMUP } from './constants';
import type { RobotApp } from './contract';
import { HoverController } from './controller';
import { lexicon } from './lexicon';
import { runtimeFor } from './runtime';
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
    const paths = robotFileList(source);
    const settled = await Promise.allSettled(paths.map((path) => (path === 'SOURCE.json' ? Promise.resolve(source) : readOne(path))));
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const bytes = settled.map((r) => (r as PromiseFulfilledResult<Uint8Array>).value);
    paths.forEach((path, i) => { out[path] = bytes[i]!; });
  } catch (e) {
    throw new Error(MISSING_ASSETS, { cause: e });
  }
  return out;
}

// ---------------------------------------------------------------- app

/** Number of PRNG draws that initState makes: the x, y and z offsets from the hover point. */
export const INIT_DRAWS = 3;

export const hover: RobotApp = {
  id: 'hover',
  name: 'Hover (Skydio X2)',
  sceneFile: 'scene.xml',
  simDt: SIM_DT,
  controlDt: CONTROL_DT,
  warmup: WARMUP,
  lexicon,
  names: HOVER_NAMES as unknown as NonNullable<RobotApp['names']>,

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

  makeController(ctx) {
    return new HoverController(ctx);
  },

  /**
   * The drone level and at rest, within START_OFFSET of the hover point on each axis. Three draws, in this order:
   * x, y, z. Motor thrust starts at zero: the controller finds the hover thrust itself.
   */
  initState(ctx, rng) {
    const rt = runtimeFor(ctx);
    const { qpos, qvel } = rt;
    qvel.fill(0);
    qpos[0] = HOVER_POINT.x + START_OFFSET * (2 * rng() - 1);
    qpos[1] = HOVER_POINT.y + START_OFFSET * (2 * rng() - 1);
    qpos[2] = HOVER_POINT.z + START_OFFSET * (2 * rng() - 1);
    qpos[3] = 1; qpos[4] = 0; qpos[5] = 0; qpos[6] = 0;
  },

  signals(ctx, out) {
    writeSignals(ctx, out);
  },
};

export default hover;
