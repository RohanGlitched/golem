// Synthetic trial module used by pool tests: a pure function of the spec, no MuJoCo, no app files.
export function poseFrames(seed, nbody = 2, frames = 3) {
  const out = new Float32Array(nbody * 7 * frames);
  for (let i = 0; i < out.length; i++) out[i] = ((seed + i * 31) % 997) / 997;
  return out;
}

export function createTrialFn(appId, config) {
  const offset = typeof config.offset === 'number' ? config.offset : 0;
  return (spec) => {
    if (typeof config.throwSeed === 'number' && spec.seed === config.throwSeed) throw new Error(`synthetic failure at seed ${spec.seed}`);
    const x = spec.scenario.x ?? 0;
    const result = { spec, robustness: offset + 10 - x + (spec.seed % 7) / 100, worstAt: x / 2, unit: 'm', wallMs: 0 };
    if (spec.record === 'poses') result.poses = { fps: 50, nbody: 2, frames: poseFrames(spec.seed) };
    return result;
  };
}
