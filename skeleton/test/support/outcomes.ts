// Builders for RequirementOutcome values used by formatter, gate and command tests.
import type { RunMetadata } from '../../src/falsify/index.js';
import type { CompiledRequirement } from '../../src/cli/sibling-types.js';
import type { RequirementOutcome } from '../../src/cli/types.js';
import { compileTiny } from './tiny-app.js';

export const tinyReqs: CompiledRequirement[] = compileTiny();
export const tinyReq = (id = '1.2'): CompiledRequirement => tinyReqs.find((r) => r.id === id) as CompiledRequirement;

export interface OutcomeSpec {
  id?: string;
  status: 'held' | 'broken' | 'error';
  force?: number;
  robustness?: number;
  trials?: number;
  seed?: number;
  shrunk?: boolean;
  unit?: string | undefined;
  error?: string;
  failureRate?: number;
}

export function makeOutcome(o: OutcomeSpec): RequirementOutcome {
  const req = tinyReq(o.id ?? '1.2');
  const force = o.force ?? 168;
  const seed = o.seed ?? 417;
  const robustness = o.robustness ?? (o.status === 'broken' ? -0.118 : 0.031);
  const meta = { errors: o.error !== undefined ? [{ phase: 1, message: o.error }] : [] } as unknown as RunMetadata;
  return {
    req, meta, unit: 'unit' in o ? o.unit : 'm', pinnedValid: 0,
    verdict: {
      reqId: req.id, status: o.status, trials: o.trials ?? 41, randomTrials: 16, guidedTrials: 8,
      closest: { robustness, scenario: { 'push.force': force }, seed },
      ...(o.status === 'broken'
        ? { counterexample: { reqId: req.id, scenario: { 'push.force': force }, seed, robustness, shrunk: o.shrunk ?? true, foundAfter: 5 } }
        : {}),
      ...(o.failureRate !== undefined ? { failureRateUpper95: o.failureRate } : {}),
      ms: 12,
    },
  };
}
