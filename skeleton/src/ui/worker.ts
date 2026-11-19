// Public entry `golem-spec/ui/worker`: the worker side of the studio's trial pool.
// An app's worker module (the URL passed to `mountStudio` as `workerUrl`) is
//
//   import { studioRequirements } from 'golem-spec/ui/worker';
//   export const app = ...;                       // the RobotApp
//   export const requirements = studioRequirements(app);
//
// The studio sends each requirement line with its trials, so a line edited in the tablet is tested as edited.
import { compileRequirement } from '../ears/index.js';
import type { CompiledRequirement } from '../ears/index.js';
import type { RobotApp } from '../sim/types.js';
import { decodeReqKey } from './run/req-key.js';
import { WorkerRunner } from '../pool/worker-runner.js';
import type { HostMessage, WorkerMessage } from '../pool/protocol.js';

/** Resolves a studio requirement key to a compiled requirement. Compiles each distinct line once. */
export function studioRequirements(app: Pick<RobotApp, 'lexicon'>): (key: string) => CompiledRequirement | undefined {
  const cache = new Map<string, CompiledRequirement>();
  return (key) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const k = decodeReqKey(key);
    if (!k) return undefined;
    const r = compileRequirement(k.source, app.lexicon, { id: k.id });
    if (!r.requirement) {
      const why = r.diagnostics.find((d) => d.severity === 'error')?.message ?? 'it does not compile';
      throw new Error(`Requirement ${k.id} cannot be tested in the worker: ${why}`);
    }
    cache.set(key, r.requirement);
    return r.requirement;
  };
}

/**
 * Runs the whole trial-worker side for one app, for bundlers that build a worker file as a standalone entry and
 * drop its exports (Vite's `?worker&url` does). Use it as the pool's worker script instead of the default entry:
 *
 *   import app from './app';
 *   import { serveStudioWorker } from 'golem-spec/ui/worker';
 *   serveStudioWorker(app);
 *
 * The app is imported statically, so the `appModule` URL in the pool config is not needed (it is ignored).
 */
export function serveStudioWorker(app: RobotApp): void {
  const requirements = studioRequirements(app);
  const runner = new WorkerRunner(async () => {
    const sim = await import('../sim/index.js');
    const cache = new sim.ModelCache();
    await cache.getModel(app); // load MuJoCo and compile the model once, before `ready`
    return {
      trial: (spec) => {
        const r = requirements(spec.reqId);
        if (r === undefined) throw new Error(`app ${app.id} has no requirement "${spec.reqId}"`);
        return sim.runTrial(app, r, spec, { cache });
      },
      liveHandles: sim.liveHandleCount,
      dispose: () => cache.dispose(),
    };
  });
  const scope = globalThis as unknown as {
    addEventListener(type: 'message', cb: (e: { data: HostMessage }) => void): void;
    postMessage(msg: WorkerMessage, transfer: Transferable[]): void;
  };
  scope.addEventListener('message', (e) => {
    void runner.handle(e.data, (out, transfer) => scope.postMessage(out, transfer ?? []));
  });
}
