// Public surface of the falsify module (browser-safe: no Node module is imported from here).
export { falsify } from './falsifier.js';
export { latinHypercube } from './lhs.js';
export { shrink, DEFAULT_SHRINK } from './shrink.js';
export { verificationSeeds, classify } from './classify.js';
export { failureRateUpper95, clopperPearsonUpper } from './beta.js';
export { replayCounterexample } from './replay.js';
export type { ReplayCounterexampleOptions, ReplayedTrial } from './replay.js';
export { createSeedDatabase, pinCounterexample, canonicalJson, counterexampleEquals } from './seed-db.js';
export { memoryFileSystem } from './fs.js';
export {
  AbortError, PoolClosedError, CancelledError, TrialError, TrialCrashError, RestartLimitError, LoadError, SeedDbError,
} from './errors.js';

export type {
  Budget, SeedReader, PinnedSeedEntry, ProgressEvent, FalsifyOptions, ResolvedConfig, RunMetadata, FalsifyResult, ReplayOptions, ResultInfo, CemDimInfo,
} from './types.js';
export type { SeedDatabase } from './seed-db.js';
export type { FileSystem, MemoryFileSystem, FsMethod, FsCall } from './fs.js';
export type { ShrinkLimits, ShrinkOutcome, ShrinkRunner, ShrinkTrialOutcome, ShrinkTrialLog } from './shrink.js';
export type { Classification } from './classify.js';
// Contract shapes from interfaces.md that ears and sim do not already export.
// `RunOptions` is exported as `PoolRunOptions` because sim exports its own `RunOptions`.
export type {
  FalsifiableRequirement, TrialSpec, TrialResult, Counterexample, Verdict, TrialPool,
  RunOptions as PoolRunOptions,
} from './contract.js';
