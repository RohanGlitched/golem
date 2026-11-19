// Test-only entry (golem-spec/testing): synthetic robustness functions, a direct pool, fake workers and
// fake timers. It needs fast-check, which is an optional peer dependency. Never imported by engine code.
export {
  arbDimension, arbSpace, arbSynthetic, makeSynthetic, syntheticTrialFn, scenarioFromFractions, directPool,
} from './falsify/testing.js';
export type { RobustnessFn, SynthSpec, DirectPool, DirectPoolOptions } from './falsify/testing.js';
export { fakeWorkerFactory, FakeTimers, tick } from './pool/testing.js';
export type { FakeScript, FakeWorker, FakeWorkerFactory, JobAction, JobInfo } from './pool/testing.js';
