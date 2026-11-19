// Error classes with a stable `name` and `cause` support. Messages are plain and exact.

type Opts = { cause?: unknown };

export class AbortError extends Error {
  override name = 'AbortError';
  constructor(message = 'the operation was aborted', options?: Opts) { super(message, options); }
}
export class PoolClosedError extends Error {
  override name = 'PoolClosedError';
  constructor(message = 'pool is closed', options?: Opts) { super(message, options); }
}
export class CancelledError extends Error {
  override name = 'CancelledError';
  constructor(message = 'run cancelled because the pool was closed', options?: Opts) { super(message, options); }
}
export class TrialError extends Error {
  override name = 'TrialError';
  constructor(message: string, options?: Opts) { super(message, options); }
}
export class TrialCrashError extends Error {
  override name = 'TrialCrashError';
  constructor(message: string, options?: Opts) { super(message, options); }
}
export class RestartLimitError extends Error {
  override name = 'RestartLimitError';
  constructor(message: string, options?: Opts) { super(message, options); }
}
export class LoadError extends Error {
  override name = 'LoadError';
  constructor(message: string, options?: Opts) { super(message, options); }
}
export class SeedDbError extends Error {
  override name = 'SeedDbError';
  constructor(message: string, options?: Opts) { super(message, options); }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
