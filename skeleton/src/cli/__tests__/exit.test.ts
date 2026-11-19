import { describe, expect, it } from 'vitest';
import { HookExit, gateExitCode, testExitCode } from '../exit.js';

const s = (...x: ('held' | 'broken' | 'error')[]) => x.map((status) => ({ status }));

describe('testExitCode', () => {
  it.each([
    [s('held', 'held'), 0], [s('held', 'error'), 1], [s('error', 'broken'), 2], [s('broken'), 2], [[], 0],
  ])('maps %j to %i', (v, code) => { expect(testExitCode(v)).toBe(code); });
});

describe('gateExitCode', () => {
  it('is 0 only for a non-empty all-held list without --kiro', () => {
    expect(gateExitCode(s('held'), false)).toBe(0);
    expect(gateExitCode([], false)).toBe(2);
    expect(gateExitCode(s('held', 'error'), false)).toBe(2);
    expect(gateExitCode(s('broken'), false)).toBe(2);
  });

  it('is 0 for every outcome with --kiro and 1 for a start error in both modes', () => {
    expect(gateExitCode(s('broken'), true)).toBe(0);
    expect(gateExitCode([], true)).toBe(0);
    expect(gateExitCode(s('held'), true, true)).toBe(1);
    expect(gateExitCode(s('held'), false, true)).toBe(1);
  });

  it('exposes the three codes', () => { expect(HookExit).toEqual({ ok: 0, error: 1, broken: 2 }); });
});
