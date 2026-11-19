// Exit codes. One pure function holds each mapping.
import { meetsExpectation, type Expectation } from './expectation.js';
import type { Verdict } from './sibling-types.js';

export const HookExit = { ok: 0, error: 1, broken: 2 } as const;

type Statuses = readonly (Pick<Verdict, 'status'> & { expectation?: Expectation })[];

/** 2 if any `broken`, else 1 if any `error`, else 0 (requirements 4.11, 4.12, 5.5). */
export function testExitCode(verdicts: Statuses): 0 | 1 | 2 {
  if (verdicts.some((v) => v.status === 'broken')) return 2;
  if (verdicts.some((v) => v.status === 'error')) return 1;
  return 0;
}

/**
 * `startError` is a usage or Config_File error (1 in both modes), or, without `--kiro`, a compile error.
 * With `--kiro` every other outcome exits 0, because the block decision travels on stdout (requirement 8.22).
 * Without `--kiro` the gate is green only for a non-empty list in which every line meets its expectation (a status of
 * `held` for Expected_Hold, which is the default, `broken` for Expected_Break); otherwise 2.
 */
export function gateExitCode(verdicts: Statuses, kiro: boolean, startError = false): 0 | 1 | 2 {
  if (startError) return 1;
  if (kiro) return 0;
  return verdicts.length > 0 && verdicts.every((v) => meetsExpectation(v.status, v.expectation ?? 'Expected_Hold')) ? 0 : 2;
}
