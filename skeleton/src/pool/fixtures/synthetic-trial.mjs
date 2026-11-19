// Synthetic trial module used by pool tests: a pure function of the spec, no MuJoCo, no app files.
export function poseFrames(seed, nbody = 2, frames = 3) {
  const out = new Float32Array(nbody * 7 * frames);
  for (let i = 0; i < out.length; i++) out[i] = ((seed + i * 31) % 997) / 997;
  return out;
}

export function createTrialFn(appId, config) {
  if (typeof config.loadFailSlot === 'string') throw new Error(config.loadFailSlot);
  const offset = typeof config.offset === 'number' ? config.offset : 0;
  // The frames of the previous pose trial in this worker, to observe that the transfer detached them.
  let lastFrames;
  return (spec) => {
    if (typeof config.throwSeed === 'number' && spec.seed === config.throwSeed) throw new Error(`synthetic failure at seed ${spec.seed}`);
    if (typeof config.exitSeed === 'number' && spec.seed === config.exitSeed) process.exit(3);
    const x = spec.scenario.x ?? 0;
    const result = { spec, robustness: offset + 10 - x + (spec.seed % 7) / 100, worstAt: x / 2, unit: 'm', wallMs: 0 };
    if (config.reportTransfer === true) result.prevFramesByteLength = lastFrames === undefined ? -1 : lastFrames.byteLength;
    if (spec.record === 'poses') {
      lastFrames = poseFrames(spec.seed);
      result.poses = { fps: 50, nbody: 2, frames: lastFrames };
    }
    return result;
  };
}
