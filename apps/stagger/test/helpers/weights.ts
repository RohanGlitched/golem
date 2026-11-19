import { POLICY_SHAPES } from '../../controller/policy';

/** Every policy tensor filled with one value. */
export function constantWeights(v: number): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  for (const [k, s] of Object.entries(POLICY_SHAPES)) out[k] = new Float32Array(s.reduce((a, b) => a * b, 1)).fill(v);
  return out;
}
