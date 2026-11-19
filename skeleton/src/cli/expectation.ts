// The Expectation table of a requirements.md: `| Criterion | Topic | Expectation |` with Expected_Hold / Expected_Break.
// A line with no row, or no table at all, is Expected_Hold. The gate is green when every line meets its expectation.
import type { Verdict } from './sibling-types.js';
import type { RequirementOutcome } from './types.js';

export type Expectation = 'Expected_Hold' | 'Expected_Break';

export const DEFAULT_EXPECTATION: Expectation = 'Expected_Hold';

export interface ParsedExpectations {
  /** Criterion id (as written in the first column) to expectation, for every row with a valid value. */
  byId: Map<string, Expectation>;
  /** Rows that could not be read, as plain sentences. */
  problems: string[];
}

const cells = (row: string): string[] => {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim().replace(/^[*`_]+|[*`_]+$/g, ''));
};

const isSeparator = (row: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes('-');

/** Reads every table whose header has a `Criterion` and an `Expectation` column. */
export function parseExpectations(text: string): ParsedExpectations {
  const byId = new Map<string, Expectation>();
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  let idCol = -1;
  let expCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i] as string;
    if (!s.trim().startsWith('|')) { idCol = -1; expCol = -1; continue; }
    const c = cells(s);
    if (idCol < 0) {
      const a = c.findIndex((x) => /^criterion$/i.test(x));
      const b = c.findIndex((x) => /^expectation$/i.test(x));
      if (a >= 0 && b >= 0) { idCol = a; expCol = b; }
      continue;
    }
    if (isSeparator(s)) continue;
    const id = c[idCol] ?? '';
    const value = c[expCol] ?? '';
    if (id === '') continue;
    const m = /^expected[_ -]?(hold|break)$/i.exec(value);
    if (m === null) {
      problems.push(`line ${i + 1}: the expectation of ${id} is "${value}"; use Expected_Hold or Expected_Break (treated as Expected_Hold)`);
      continue;
    }
    if (byId.has(id)) problems.push(`line ${i + 1}: ${id} appears twice in the expectation table; the first row is used`);
    else byId.set(id, m[1]?.toLowerCase() === 'break' ? 'Expected_Break' : 'Expected_Hold');
  }
  return { byId, problems };
}

/** Merges the tables of several files; the first file that names an id wins. */
export function mergeExpectations(parts: readonly ParsedExpectations[]): ParsedExpectations {
  const byId = new Map<string, Expectation>();
  const problems: string[] = [];
  for (const p of parts) {
    for (const [k, v] of p.byId) if (!byId.has(k)) byId.set(k, v);
    problems.push(...p.problems);
  }
  return { byId, problems };
}

export const expectationOf = (m: ReadonlyMap<string, Expectation>, id: string): Expectation => m.get(id) ?? DEFAULT_EXPECTATION;

/** The table of the files whose text is in `texts`, in `files` order: the only way the kit reads a table. */
export function readExpectations(texts: Readonly<Record<string, string>>, files: readonly string[]): ParsedExpectations {
  return mergeExpectations(files.filter((f) => Object.prototype.hasOwnProperty.call(texts, f)).map((f) => parseExpectations(texts[f] as string)));
}

/** True when the verdict is what the expectation asks for. An `error` verdict meets neither. */
export function meetsExpectation(status: Verdict['status'], e: Expectation): boolean {
  return e === 'Expected_Break' ? status === 'broken' : status === 'held';
}

/** The words that say why an expectation is not met; empty when it is. */
export function expectationMiss(status: Verdict['status'], e: Expectation, trials: number): string {
  if (meetsExpectation(status, e)) return '';
  if (status === 'error') return `${e} not met: the run ended in an error`;
  return e === 'Expected_Break'
    ? `expected to break but held within budget ${trials} trials`
    : 'expected to hold but a counterexample was found';
}

/** `[Expected_Hold: met]`, `[Expected_Break: NOT met]`. */
export const expectationTag = (status: Verdict['status'], e: Expectation): string =>
  `[${e}: ${meetsExpectation(status, e) ? 'met' : 'NOT met'}]`;

export interface Judged {
  outcome: RequirementOutcome;
  expectation: Expectation;
  /** True when the table has a row for this requirement. */
  explicit: boolean;
  met: boolean;
  /** Why it is not met; empty when it is. */
  miss: string;
}

/** Pairs every outcome with its expectation and whether the verdict meets it. */
export function judgeOutcomes(outcomes: readonly RequirementOutcome[], byId: ReadonlyMap<string, Expectation>): Judged[] {
  return outcomes.map((outcome) => {
    const expectation = expectationOf(byId, outcome.verdict.reqId);
    return {
      outcome, expectation, explicit: byId.has(outcome.verdict.reqId),
      met: meetsExpectation(outcome.verdict.status, expectation),
      miss: expectationMiss(outcome.verdict.status, expectation, outcome.verdict.trials),
    };
  });
}
