// Default loader for a worker: a synthetic `trialModule` (tests; never loads MuJoCo) or the sim trial entry.
import type { CompiledRequirement, RobotApp } from '../sim/types.js';
import type { WorkerConfig } from './protocol.js';
import type { LoadedTrial, TrialLoader } from './worker-runner.js';
import type { TrialFn } from './types.js';

type Created = TrialFn | LoadedTrial;

function asLoaded(c: Created): LoadedTrial {
  return typeof c === 'function' ? { trial: c } : c;
}

interface AppModule {
  app: RobotApp;
  requirements: Record<string, CompiledRequirement> | CompiledRequirement[] | ((id: string) => CompiledRequirement | undefined);
}

function findRequirement(m: AppModule, id: string): CompiledRequirement {
  const r = typeof m.requirements === 'function'
    ? m.requirements(id)
    : Array.isArray(m.requirements) ? m.requirements.find((x) => x.id === id) : m.requirements[id];
  if (r === undefined) throw new Error(`app module has no requirement "${id}"`);
  return r;
}

export const defaultTrialLoader: TrialLoader = async (appId, config: WorkerConfig) => {
  if (config.trialModule !== undefined) {
    const mod = (await import(/* @vite-ignore */ config.trialModule)) as {
      createTrialFn?: (appId: string, config: WorkerConfig) => Created | Promise<Created>;
    };
    if (typeof mod.createTrialFn !== 'function') {
      throw new Error(`trial module ${config.trialModule} does not export createTrialFn`);
    }
    return asLoaded(await mod.createTrialFn(appId, config));
  }
  if (config.appModule === undefined) {
    throw new Error('worker config needs trialModule (synthetic) or appModule (MuJoCo app)');
  }
  const appMod = (await import(/* @vite-ignore */ config.appModule)) as AppModule;
  const sim = await import('../sim/index.js');
  const cache = new sim.ModelCache();
  await cache.getModel(appMod.app); // load MuJoCo and compile the model once, before `ready`
  return {
    trial: (spec) => sim.runTrial(appMod.app, findRequirement(appMod, spec.reqId), spec, { cache }),
    liveHandles: sim.liveHandleCount,
    dispose: () => cache.dispose(),
  };
};
