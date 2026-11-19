// The only file that touches golem-sim loader names. Loads the hero model once and copies the
// arrays the stage builder needs, so no view into WASM memory outlives the build.
import { buildContext, loadMujoco, writeRobotFiles } from '../../sim/index.js';
import type { RobotApp, SimContext } from '../types.js';
import type { ModelLike } from '../stage/stage-builder.js';

export interface HeroModel { mj: any; model: any; data: any; ctx: SimContext; modelLike: ModelLike }

export class HeroLoadError extends Error {
  constructor(message: string, readonly stage: 'files' | 'mujoco' | 'model', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HeroLoadError';
  }
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const MODEL_FIELDS = [
  'geom_type', 'geom_group', 'geom_bodyid', 'geom_dataid', 'geom_size', 'geom_pos', 'geom_quat',
  'mesh_vertadr', 'mesh_vertnum', 'mesh_faceadr', 'mesh_facenum', 'mesh_normaladr',
  'mesh_vert', 'mesh_normal', 'mesh_face', 'mesh_facenormal',
] as const;

type Copyable = ArrayLike<number> & { slice?: () => ArrayLike<number> };

/** Copies the arrays once. The copy never aliases the source buffer. */
export function copyModel(model: any): ModelLike {
  const out: Record<string, unknown> = { nbody: Number(model.nbody), ngeom: Number(model.ngeom) };
  for (const f of MODEL_FIELDS) {
    const src = model[f] as Copyable | undefined;
    if (src === undefined || src === null) { out[f] = new Float64Array(0); continue; }
    out[f] = ArrayBuffer.isView(src) ? (src as unknown as Float64Array).slice() : Float64Array.from(src);
  }
  return out as unknown as ModelLike;
}

export interface LoadHeroDeps { load?: () => Promise<any> }

export async function loadHero(app: RobotApp, deps: LoadHeroDeps = {}): Promise<HeroModel> {
  let files: Record<string, Uint8Array>;
  const filesP = Promise.resolve().then(() => app.files());
  let mj: any;
  try {
    mj = await (deps.load ?? loadMujoco)();
  } catch (e) {
    filesP.catch(() => {});
    throw new HeroLoadError(`Could not load MuJoCo for ${app.name}: ${msgOf(e)}. Reload the page to try again.`, 'mujoco', { cause: e });
  }
  try {
    files = await filesP;
  } catch (e) {
    throw new HeroLoadError(
      `Could not load the files of ${app.name}: ${msgOf(e)}. Check that the robot files are served from the same origin.`, 'files', { cause: e },
    );
  }
  let model: any;
  let data: any;
  try {
    writeRobotFiles(mj, app, files);
    model = mj.MjModel.from_xml_path(`/robot/${app.sceneFile}`);
    data = new mj.MjData(model);
    const ctx = buildContext(mj, model, data, app.names);
    mj.mj_forward?.(model, data);
    return { mj, model, data, ctx, modelLike: copyModel(model) };
  } catch (e) {
    try { data?.delete?.(); } catch { /* already gone */ }
    try { model?.delete?.(); } catch { /* already gone */ }
    throw new HeroLoadError(`Could not build the model of ${app.name}: ${msgOf(e)}. Reload the page to try again.`, 'model', { cause: e });
  }
}
