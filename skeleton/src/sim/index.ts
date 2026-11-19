// Public surface of the sim module. HandleRegistry, TrialScope, loader test seams and fixtures stay internal.
export { loadMujoco } from './loader.js';
export { writeRobotFiles, validateRobotPaths } from './file-writer.js';
export { ModelCache } from './model-cache.js';
export { buildContext } from './context.js';
export { liveHandleCount } from './handles.js';
export { withDoubleBuffer, geomDistance, forEachContact, readWarnings, createSaturationMeter } from './helpers.js';
export { mulberry32 } from './prng.js';
export { runTrial, DIVERGED_ROBUSTNESS } from './episode.js';
export { changedModelFields } from './model-snapshot.js';
export { recheckTrial, otherIntegrator } from './recheck.js';
export type { RecheckReport, RecheckVariant } from './recheck.js';
export { PoseRecorder } from './pose-recorder.js';
export { testApp, makeTestRequirement } from './test-app.js';
export { SimError } from './errors.js';
export type {
  Mj, ObjType, EarlyStopHook, RunOptions, IntegratorName, DivergenceInfo, TrialDiagnostics,
} from './types.js';
