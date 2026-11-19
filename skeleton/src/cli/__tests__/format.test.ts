import { describe, expect, it } from 'vitest';
import {
  buildReason, checkJson, diagnosticText, diagnosticsReason, formatMargin, formatQuantity, formatScenario, gateBlock,
  progressLine, requirementLine, sortDiagnostics, redAllowMessage,
} from '../format.js';
import { makeOutcome, tinyReq } from '../../../test/support/outcomes.js';
import type { FileDiagnostic } from '../types.js';

describe('quantities', () => {
  it('writes SI values with units', () => {
    expect(formatQuantity('force', 168)).toBe('168 N');
    expect(formatQuantity('angle', (135 * Math.PI) / 180)).toBe('135 deg');
    expect(formatQuantity('ratio', 0.3)).toBe('30 %');
    expect(formatQuantity('phase', 0.62)).toBe('0.62 (stride phase)');
    expect(formatQuantity('speed', 0.5)).toBe('0.5 m/s');
  });

  it('formats a scenario in space order and a margin with sign and unit', () => {
    expect(formatScenario(tinyReq().space, { 'push.force': 168 })).toBe('push.force = 168 N');
    expect(formatMargin(-0.118, 'm')).toBe('-0.118 m');
    expect(formatMargin(0.031, 'm')).toBe('+0.031 m');
    expect(formatMargin(NaN, 'm')).toBe('margin unavailable');
    expect(formatMargin(0.5, undefined)).toBe('+0.5 unit not declared');
  });
});

describe('requirementLine', () => {
  it('prints a broken requirement with margin, trials, scenario and seed', () => {
    expect(requirementLine(makeOutcome({ status: 'broken' })))
      .toBe('1.2  BROKEN  margin -0.118 m  41 trials  push.force = 168 N  (shrunk, seed 417)');
  });

  it('prints "no counterexample found in N trials" for a held requirement', () => {
    expect(requirementLine(makeOutcome({ status: 'held', trials: 64 }))).toContain('no counterexample found in 64 trials');
  });

  it('adds the 95 % failure rate bound when the verdict has one', () => {
    expect(requirementLine(makeOutcome({ status: 'held', failureRate: 0.0456 }))).toContain('failure rate below 4.56 % at 95 % confidence');
  });

  it('prints the first error message for an error requirement', () => {
    expect(requirementLine(makeOutcome({ status: 'error', error: 'pool crashed' }))).toBe('1.2  ERROR  41 trials  pool crashed');
  });
});

describe('gateBlock', () => {
  it('has the EARS line, scenario, margin and the replay command', () => {
    const b = gateBlock(makeOutcome({ status: 'broken' }), 'WHEN x THE robot SHALL y');
    expect(b.split('\n')).toEqual([
      '1.2: WHEN x THE robot SHALL y',
      '  scenario: push.force = 168 N (seed 417)',
      '  margin: -0.118 m',
      '  reproduce: npx golem-spec replay 1.2',
    ]);
  });

  it('puts the cause in place of scenario and margin for an error requirement', () => {
    const b = gateBlock(makeOutcome({ status: 'error', error: 'boom' }), 'EARS');
    expect(b).toContain('error: boom');
    expect(b).not.toContain('scenario:');
  });
});

describe('progressLine', () => {
  it('names phase, generation, lowest margin with unit, trials used and remaining', () => {
    const e = {
      phase: 2, generation: 1, scenarios: [], robustness: [], lowestRobustness: -0.02, trialsUsed: 40, trialsRemaining: 24,
      seeds: [], elapsedMs: 1200, timeFraction: null } as const;
    expect(progressLine(e, 'guided', { reqId: 'R3', unit: 'm' })).toBe('R3  guided generation 1: lowest -0.02 m, 40 trials used, 24 remaining');
    expect(progressLine({ ...e, trialsRemaining: null }, 'random')).toContain('no trial limit');
  });
});

describe('buildReason', () => {
  it('joins blocks with one blank line when they fit', () => {
    expect(buildReason(['a\nb', 'c'], 'r.json')).toBe('a\nb\n\nc');
  });

  it('cuts at a line boundary and ends with the report path when over the limit', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => `block ${i}\nsecond line of block ${i}`);
    const r = buildReason(blocks, '.golem/report.json');
    expect(r.length).toBeLessThanOrEqual(4000);
    expect(r.endsWith('... truncated, see .golem/report.json')).toBe(true);
    expect(blocks.join('\n\n').startsWith(r.slice(0, r.lastIndexOf('\n')))).toBe(true);
  });
});

describe('diagnostics', () => {
  const d = (file: string, line: number, column: number, severity: 'error' | 'warning', suggestion?: string): FileDiagnostic => ({
    file, line, column, severity, kind: 'UNKNOWN_PHRASE', message: 'm', start: 0, end: 1, ...(suggestion !== undefined ? { suggestion } : {}),
  });

  it('sorts by file order, line and column', () => {
    const s = sortDiagnostics([d('b', 1, 1, 'error'), d('a', 3, 2, 'error'), d('a', 3, 1, 'error'), d('a', 1, 9, 'warning')], ['a', 'b']);
    expect(s.map((x) => `${x.file}:${x.line}:${x.column}`)).toEqual(['a:1:9', 'a:3:1', 'a:3:2', 'b:1:1']);
  });

  it('prints file:line:col: severity: message and a suggestion line', () => {
    expect(diagnosticText(d('r.md', 4, 7, 'error', 'keep its height above {length}')))
      .toBe('r.md:4:7: error: m\n  suggestion: keep its height above {length}');
  });

  it('builds a reason that lists the errors and the json check with null suggestions', () => {
    expect(diagnosticsReason([d('r.md', 4, 7, 'error'), d('r.md', 5, 1, 'warning')])).toContain('r.md:4:7: error: m');
    expect(diagnosticsReason([d('r.md', 5, 1, 'warning')])).not.toContain('r.md:5:1');
    const j = checkJson([tinyReq()], [d('r.md', 4, 7, 'error')]);
    expect(j.ok).toBe(false);
    expect(j.diagnostics[0]?.suggestion).toBeNull();
    expect(j.requirements[0]).toMatchObject({ id: '1.2', pattern: 'event' });
  });
});

describe('redAllowMessage', () => {
  it('states RED and lists the requirement ids with their EARS lines', () => {
    const m = redAllowMessage('s1', [{ id: 'R3', ears: 'WHEN a THE robot SHALL b' }]);
    expect(m).toContain('RED');
    expect(m).toContain('R3: WHEN a THE robot SHALL b');
  });
});
