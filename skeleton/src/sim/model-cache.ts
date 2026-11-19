// Compiles each app's model once per worker and keeps it. One ModelCache per worker.
import { SimError, errorMessage } from './errors.js';
import { registry } from './handles.js';
import { writeRobotFiles } from './file-writer.js';
import { loadMujoco } from './loader.js';
import type { Mj, RobotApp } from './types.js';

export interface CachedModel { mj: Mj; model: any }

export class ModelCache {
  private readonly entries = new Map<string, Promise<CachedModel>>();
  private readonly settled = new Map<string, any>();
  private generation = 0;
  private readonly load: () => Promise<Mj>;

  constructor(deps?: { load?: () => Promise<Mj> }) {
    this.load = deps?.load ?? loadMujoco;
  }

  get size(): number { return this.entries.size; }
  has(appId: string): boolean { return this.entries.has(appId); }

  getModel(app: RobotApp): Promise<CachedModel> {
    const existing = this.entries.get(app.id);
    if (existing) return existing;
    const gen = this.generation;
    const p = this.compile(app, gen);
    this.entries.set(app.id, p);
    p.catch(() => {
      if (this.entries.get(app.id) === p) this.entries.delete(app.id);
    });
    return p;
  }

  private async compile(app: RobotApp, gen: number): Promise<CachedModel> {
    let model: any;
    try {
      const mj = await this.load();
      const files = await app.files();
      writeRobotFiles(mj, app, files);
      model = (mj as any).MjModel.from_xml_path(`/robot/${app.sceneFile}`);
      registry.track(model, 'MjModel');
      if (gen !== this.generation) {
        registry.release(model);
        throw new SimError('the model cache was disposed while this model was compiling');
      }
      this.settled.set(app.id, model);
      return { mj, model };
    } catch (cause) {
      if (model !== undefined) registry.release(model);
      throw new SimError(`Compiling app ${app.id} failed: ${errorMessage(cause)}`, { cause });
    }
  }

  /** Deletes every settled model once and forgets all entries. */
  dispose(): void {
    this.generation++;
    const models = [...this.settled.values()];
    this.settled.clear();
    this.entries.clear();
    let first: unknown;
    let failed = false;
    for (const m of models) {
      try { registry.release(m); } catch (e) { if (!failed) { failed = true; first = e; } }
    }
    if (failed) throw first;
  }
}
