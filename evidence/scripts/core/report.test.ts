import { describe, expect, it } from 'vitest';
import { buildReport, criterionText, fmtP, type ReportInput } from './report.js';
import { summarizeFalsifier, type FalsifierRecord } from './falsifier-summary.js';

const md = '### Requirement 1: x\n\n#### Acceptance Criteria\n\n1. WHEN a THE robot SHALL b\n2. WHEN c THE robot SHALL d\n### Requirement 2: y\n1. WHEN e THE robot SHALL f\n';

const rec = (o: Partial<FalsifierRecord>): FalsifierRecord => ({
  app: 'stagger', reqId: '1.2', arm: 'guided', searchSeed: 1, attempt: 1, budget: 96, status: 'broken', found: true,
  trialsToFirst: 10, sevFound: 0.5, sevShrunk: 0.4, robustness: -1, trials: 32, wallMs: 1, ...o,
});

function input(): ReportInput {
  const recs: FalsifierRecord[] = [];
  for (let s = 1; s <= 6; s++) { recs.push(rec({ searchSeed: s })); recs.push(rec({ searchSeed: s, arm: 'random', trialsToFirst: 30, sevShrunk: null })); }
  return {
    notes: 'A thing went wrong.', repoCommit: 'abc123',
    falsifier: {
      meta: { commit: 'abc', budget: 96, searchSeeds: 6 }, summary: summarizeFalsifier(recs, 96), lines: { 'stagger|1.2': criterionText(md, '1.2') ?? '' },
      errors: 0, totalRuns: 12, skippedApps: ['candy'],
    },
    agent: { runs: [], dryRuns: [{ dryRun: true, arm: 'A', index: 0, app: 'stagger', status: 'ok', credits: 1.5, turns: 2, durationS: 30, claimsSuccess: false, gateGreen: false, gateExit: 2, falseClaim: false, reqModified: false, filesChanged: [], finalMessage: '' }], cap: 150, n: 6 },
  };
}

describe('criterionText', () => {
  it('finds the Nth line of the Rth requirement', () => {
    expect(criterionText(md, '1.2')).toBe('WHEN c THE robot SHALL d');
    expect(criterionText(md, '2.1')).toBe('WHEN e THE robot SHALL f');
    expect(criterionText(md, '3.1')).toBeUndefined();
  });
});

describe('buildReport', () => {
  it('is a pure function: the same input gives the same bytes', () => {
    expect(buildReport(input()).markdown).toBe(buildReport(input()).markdown);
  });
  it('covers methods, budgets, results with intervals, limits and what went wrong', () => {
    const { markdown } = buildReport(input());
    for (const h of ['Experiment 1', 'Experiment 2', 'Experiment 3', '## Limits', '## What went wrong', 'A thing went wrong.', 'budget 96', 'Clopper-Pearson', 'Bonferroni']) expect(markdown).toContain(h);
    expect(markdown).toMatch(/6\/6 \(54% to 100%\)/);
  });
  it('says plainly that the agent experiment was not run, and reports the dry-run credits apart', () => {
    const { markdown } = buildReport(input());
    expect(markdown).toContain('the full experiment has not been run');
    expect(markdown).toContain('1.50 credits');
  });
  it('reports a significant difference with its direction', () => {
    const { markdown } = buildReport(input());
    expect(markdown).toContain('guided sooner');
  });
  it('formats p-values', () => {
    expect(fmtP(0.5)).toBe('0.500');
    expect(fmtP(0.00001)).toBe('1.0e-5');
  });
});