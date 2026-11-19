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
