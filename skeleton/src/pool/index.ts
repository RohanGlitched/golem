// Public surface of the pool module (browser-safe). The Node adapter is exported from golem-spec/node only.
export { InProcessPool } from './in-process.js';
export type { InProcessPoolOptions } from './in-process.js';
export { createBrowserPool, defaultBrowserPoolSize } from './browser.js';
export type { BrowserPoolOptions } from './browser.js';
export { TrialScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
export type { WorkerLike, WorkerFactory, SchedulerTimers } from './worker-like.js';
export type { PoolOptions, TrialFn } from './types.js';
export { transferList } from './protocol.js';
export type { HostMessage, WorkerMessage, WorkerConfig } from './protocol.js';
export { WorkerRunner, HandleTracker } from './worker-runner.js';
export type { LoadedTrial, TrialLoader, Deletable as TrackedHandle } from './worker-runner.js';
