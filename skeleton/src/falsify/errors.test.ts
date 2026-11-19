import { describe, expect, it } from 'vitest';
import {
  AbortError, CancelledError, LoadError, PoolClosedError, RestartLimitError, SeedDbError, TrialCrashError,
  TrialError,
} from './errors.js';
import type { FalsifyOptions, FalsifyResult, ProgressEvent, RunMetadata, PinnedSeedEntry, Budget } from './types.js';
import type { PoolOptions, RunOptions, TrialFn } from '../pool/types.js';

const classes = [
  ['AbortError', AbortError], ['PoolClosedError', PoolClosedError], ['CancelledError', CancelledError],
  ['TrialError', TrialError], ['TrialCrashError', TrialCrashError], ['RestartLimitError', RestartLimitError],
  ['LoadError', LoadError], ['SeedDbError', SeedDbError],
] as const;

describe('error classes', () => {
  for (const [name, C] of classes) {
    it(`${name} has a stable name and is an Error`, () => {
      const e = new C('boom');
      expect(e.name).toBe(name);
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('boom');
    });
    it(`${name} keeps its cause`, () => {
      const cause = new Error('root');
      expect(new C('boom', { cause }).cause).toBe(cause);
    });
  }
  it('AbortError and PoolClosedError have default messages', () => {
    expect(new AbortError().message).toMatch(/aborted/);
    expect(new PoolClosedError().message).toBe('pool is closed');
  });
});

describe('shared types', () => {
  it('compile with the documented shapes', () => {
    const b: Budget = { maxTrials: 10 };
    const o: FalsifyOptions = { appId: 'a', budget: b, searchSeed: 1 };
    const p: PoolOptions = { size: 2 };
    const r: RunOptions = {};
    const f: TrialFn = (spec) => ({ spec, robustness: 1, worstAt: 0, unit: 'm', wallMs: 0 });
    const types: unknown[] = [o, p, r, f];
    type _ = [FalsifyResult, ProgressEvent, RunMetadata, PinnedSeedEntry];
    expect(types).toHaveLength(4);
  });
});
