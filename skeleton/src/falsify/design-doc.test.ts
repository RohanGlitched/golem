import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CP_TOLERANCE } from './beta.js';
import { BudgetClock, QUOTA_EPSILON, WAVE_EMA_WEIGHT } from './budget.js';
import { DEFAULT_CEM } from './cem.js';
import { DEFAULT_PHASE1_FRACTION, DEFAULT_PHASE1_GENERATION_SIZE, DEFAULT_SHRINK_RESERVE } from './falsifier.js';
import { DEFAULT_SHRINK, SWEEP } from './shrink.js';

// golem-falsify-hardening defect 9: the design document must describe the code as it is.
const DESIGN = fileURLToPath(new URL('../../../.kiro/specs/golem-falsify/design.md', import.meta.url));
const doc = readFileSync(DESIGN, 'utf8').replace(/\r\n/g, '\n');

function section(title: string): string {
  const start = doc.indexOf(`\n### ${title}`);
  expect(start, `section "${title}"`).toBeGreaterThanOrEqual(0);
  const end = doc.indexOf('\n### ', start + 5);
  return doc.slice(start, end < 0 ? undefined : end);
}

describe('golem-falsify design document', () => {
  it('lists only BudgetClock methods that exist', () => {
    const s = section('7. Budget and clock');
    const block = /```ts\n([\s\S]*?)```/.exec(s)?.[1] ?? '';
    expect(block).toContain('class BudgetClock');
    const names = [...block.matchAll(/(?:^|[\s;{])([a-zA-Z]\w*)\s*\(/gm)].map((m) => m[1]!).filter((n) => n !== 'constructor');
    expect(names.length).toBeGreaterThan(5);
    const clock = new BudgetClock({ maxTrials: 10 }, { phase1Fraction: 0.2, phase2Fraction: 0.8, randomOnly: false, reserveFraction: 0.15, reserveMin: 12 });
    for (const n of names) expect(typeof (clock as unknown as Record<string, unknown>)[n], `BudgetClock.${n}`).toBe('function');
    const fields = [...block.matchAll(/^\s*(?:readonly\s+)?([a-zA-Z]\w*)\s*:/gm)].map((m) => m[1]!);
    for (const f of fields) expect(f in clock, `BudgetClock.${f}`).toBe(true);
  });

  it('states the defaults the code uses', () => {
    const s = section('Defaults');
    const table = new Map([...s.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)].map((m) => [m[1]!, m[2]!]));
    const expected: Record<string, number> = {
      phase1Fraction: DEFAULT_PHASE1_FRACTION,
      phase1GenerationSize: DEFAULT_PHASE1_GENERATION_SIZE,
      'cem.generationSize': DEFAULT_CEM.genSize,
      'cem.eliteFraction': DEFAULT_CEM.eliteFraction,
      'cem.smoothing': DEFAULT_CEM.smoothing,
      'cem.lhsFraction': DEFAULT_CEM.lhsFraction,
      'shrink.tolerance': DEFAULT_SHRINK.tolerance,
      'shrink.maxTrials': DEFAULT_SHRINK.maxTrials,
      'shrink.reserveFraction': DEFAULT_SHRINK_RESERVE.reserveFraction,
      'shrink.reserveMin': DEFAULT_SHRINK_RESERVE.reserveMin,
      'shrink sweep points': SWEEP,
      'Clopper-Pearson bisection tolerance': CP_TOLERANCE,
      'wave estimate weight': WAVE_EMA_WEIGHT,
      'quota epsilon': QUOTA_EPSILON,
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(table.has(name), `Defaults row for ${name}`).toBe(true);
      expect(Number(table.get(name)), name).toBe(value);
    }
  });

  it('carries none of the drifted statements found by the audit', () => {
    expect(doc).not.toMatch(/canStartGeneration|started\(\): void/);
    expect(section('9. Failure-rate bound')).not.toMatch(/below `1e-12`|stopping tolerance on `x` is 1e-9/);
    expect(section('6. Classifier')).not.toMatch(/The shrunk scenario runs once under each of the three verification seeds/);
    expect(doc).not.toMatch(/defaults 16, 0\.25, 1|\/\/ 16, 0\.25, 1|default 0\.4/);
  });
});
