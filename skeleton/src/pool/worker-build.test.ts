import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkerEntry } from './worker-build.testkit.js';

// golem-falsify-hardening defect 6 (root cause): two test files that build the worker entry in the same
// millisecond from the same process id shared one output directory, so one file's cleanup deleted the
// other's files while they were in use (ENOTEMPTY on Windows).
describe('buildWorkerEntry', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('gives every build its own directory, even in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1795088384954);
    const a = buildWorkerEntry();
    const b = buildWorkerEntry();
    try {
      expect(a.outDir).not.toBe(b.outDir);
    } finally {
      a.dispose();
      b.dispose();
    }
    expect(existsSync(a.outDir)).toBe(false);
    expect(existsSync(b.outDir)).toBe(false);
  }, 120000);
});
