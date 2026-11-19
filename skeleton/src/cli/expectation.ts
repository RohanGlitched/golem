// The Expectation table of a requirements.md: `| Criterion | Topic | Expectation |` with Expected_Hold / Expected_Break.
// A line with no row, or no table at all, is Expected_Hold. The gate is green when every line meets its expectation.
// Whenever the kit cannot tell what a mark means, the line is Expected_Hold or the gate does not run (a table error).
import { extractCriteria } from '../ears/index.js';
import type { Verdict } from './sibling-types.js';
import type { RequirementOutcome } from './types.js';

export type Expectation = 'Expected_Hold' | 'Expected_Break';

export const DEFAULT_EXPECTATION: Expectation = 'Expected_Hold';

/** One body line of a table. `expectation` is undefined when the cell is not a mark. */
export interface ExpectationRow {
  id: string;
  /** The mark as read; undefined when the cell is neither Expected_Hold nor Expected_Break. */
  expectation: Expectation | undefined;
  file?: string;
  /** 1-based. */
  line: number;
}

/** One problem found in the tables. An error stops the gate; a warning is only shown. */
export interface TableIssue {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  /** 1-based. */
  line: number;
}

export interface ParsedExpectations {
  /** Criterion id (as written in the first column) to expectation, for every row with a valid value. */
  byId: Map<string, Expectation>;
  /** Every row of every table, in file order. */
  rows: ExpectationRow[];
  /** Everything found wrong or doubtful: parse problems first, then (after reconcile) orphan rows and unmarked lines. */
  issues: TableIssue[];
  /** The issues of `issues` that come from reading one row (an unreadable mark): they do not depend on the other rows or files. */
  scanIssues: TableIssue[];
  /** `line <n>: <message>` for every issue, for callers that print strings. */
  problems: string[];
  /** Number of tables recognised. */
  tables: number;
}

const finish = (
  byId: Map<string, Expectation>, rows: ExpectationRow[], issues: TableIssue[], tables: number, scanIssues: TableIssue[] = issues,
): ParsedExpectations => ({
  byId, rows, issues, scanIssues, tables, problems: issues.map((i) => `line ${i.line}: ${i.message}`),
});

const baseName = (f: string): string => f.split(/[\\/]/).pop() ?? f;

/**
 * One mark per id from the rows of all files, in order. The same mark twice is a warning on the later row. Two readable
 * marks that differ are an error on the later row and the id is Expected_Hold, whichever came first. An id with an
 * unreadable row is Expected_Hold if it has a readable one too, and absent otherwise (its unreadable rows are errors already).
 */
function resolveRows(rows: readonly ExpectationRow[]): { byId: Map<string, Expectation>; issues: TableIssue[] } {
  const byId = new Map<string, Expectation>();
  const issues: TableIssue[] = [];
  const first = new Map<string, ExpectationRow>();
  const conflicted = new Set<string>();
  const unreadable = new Set<string>();
  const at = (r: ExpectationRow): Pick<TableIssue, 'line'> & { file?: string } => ({ line: r.line, ...(r.file !== undefined ? { file: r.file } : {}) });
  for (const r of rows) {
    if (r.expectation === undefined) unreadable.add(r.id);
    const f = first.get(r.id);
    if (f === undefined) { first.set(r.id, r); continue; }
    if (f.expectation === undefined || r.expectation === undefined) continue;
    if (f.expectation === r.expectation) {
      issues.push({ severity: 'warning', ...at(r), message: `${r.id} appears twice in the Expectation table with the same mark; the later row is ignored` });
      continue;
    }
    conflicted.add(r.id);
    const where = f.file !== undefined && f.file !== r.file ? ` of ${baseName(f.file)}` : '';
    issues.push({
      severity: 'error', ...at(r),
      message: `the table gives ${r.id} two marks: ${f.expectation} at line ${f.line}${where} and ${r.expectation} at line ${r.line}`,
    });
  }
  for (const r of rows) {
    if (byId.has(r.id) || r.expectation === undefined) continue;
    const readable = rows.find((x) => x.id === r.id && x.expectation !== undefined);
    byId.set(r.id, conflicted.has(r.id) || unreadable.has(r.id) ? DEFAULT_EXPECTATION : (readable?.expectation as Expectation));
  }
  return { byId, issues };
}

/** `<file>:<line>: <severity>: <message>`, the file as `show` writes it (for example relative to the working directory). */
export function formatIssue(i: TableIssue, show: (file: string) => string = (f) => f): string {
  return `${i.file !== undefined ? `${show(i.file)}:${i.line}` : `line ${i.line}`}: ${i.severity}: ${i.message}`;
}

export const tableErrors = (p: Pick<ParsedExpectations, 'issues'>): TableIssue[] => p.issues.filter((i) => i.severity === 'error');

const cells = (row: string): string[] => {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim().replace(/^[*`_]+|[*`_]+$/g, ''));
};

const isSeparator = (row: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes('-');

/** Width of the leading white space, a tab counting 4. */
const indentOf = (s: string): number => {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
};

const ID_HEADER = /^(?:criterion|criteria|id|#)$/i;
const EXP_HEADER = /^expect/i;
/** A fence opens with 3 or more backticks (none after them on the line) or tildes, indented by at most 3 spaces. */
const FENCE_OPEN = /^ {0,3}(`{3,})[^`]*$|^ {0,3}(~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Reads every table whose header has an id column and an `Expectation` column, outside code. */
export function parseExpectations(text: string, file?: string): ParsedExpectations {
  const rows: ExpectationRow[] = [];
  const scan: TableIssue[] = [];
  let tables = 0;
  const lines = text.split(/\r?\n/);
  const issue = (severity: TableIssue['severity'], line: number, message: string): void => {
    scan.push({ severity, line, message, ...(file !== undefined ? { file } : {}) });
  };
  let idCol = -1;
  let expCol = -1;
  let fence: { ch: string; len: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i] as string;
    // Code is not data: a table in a fenced block is an example (defect 6).
    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(s)?.[1];
      if (close !== undefined && close[0] === fence.ch && close.length >= fence.len) fence = undefined;
      continue;
    }
    const open = FENCE_OPEN.exec(s);
    if (open !== null) {
      const run = (open[1] ?? open[2]) as string;
      fence = { ch: run[0] as string, len: run.length };
      idCol = -1; expCol = -1;
      continue;
    }
    if (!s.trim().startsWith('|')) { idCol = -1; expCol = -1; continue; }
    const c = cells(s);
    if (idCol < 0) {
      const a = c.findIndex((x) => ID_HEADER.test(x));
      const b = c.findIndex((x) => EXP_HEADER.test(x));
      if (a >= 0 && b >= 0) {
        if (indentOf(s) >= 4) issue('warning', i + 1, `the table at line ${i + 1} is indented 4 spaces, which Markdown shows as code; its rows are ignored`);
        else { idCol = a; expCol = b; tables++; }
      } else if (b >= 0 && isSeparator(lines[i + 1] ?? '')) {
        issue('warning', i + 1, `the table at line ${i + 1} has an Expectation column but no Criterion column; its rows are ignored`);
      }
      continue;
    }
    if (indentOf(s) >= 4) { idCol = -1; expCol = -1; continue; }
    if (isSeparator(s)) continue;
    const id = c[idCol] ?? '';
    const value = c[expCol] ?? '';
    if (id === '') continue;
    const m = /^expected[_ -]?(hold|break)$/i.exec(value);
    if (m === null) {
      rows.push({ id, expectation: undefined, line: i + 1, ...(file !== undefined ? { file } : {}) });
      issue('error', i + 1, `the expectation of ${id} is "${value}"; use Expected_Hold or Expected_Break`);
      continue;
    }
    const expectation: Expectation = m[1]?.toLowerCase() === 'break' ? 'Expected_Break' : 'Expected_Hold';
    rows.push({ id, expectation, line: i + 1, ...(file !== undefined ? { file } : {}) });
  }
  const resolved = resolveRows(rows);
  const all = [...scan, ...resolved.issues].sort((a, b) => a.line - b.line);
  return finish(resolved.byId, rows, all, tables, scan);
}

/** Merges the tables of several files, in order. An id that two files mark differently is an error and Expected_Hold. */
export function mergeExpectations(parts: readonly ParsedExpectations[]): ParsedExpectations {
  const rows: ExpectationRow[] = [];
  const scan: TableIssue[] = [];
  let tables = 0;
  for (const p of parts) {
    rows.push(...p.rows);
    scan.push(...p.scanIssues);
    tables += p.tables;
  }
  const resolved = resolveRows(rows);
  // Issues in file order, then by line; the parts are in file order, so the position of a file's first row decides.
  const order = new Map<string | undefined, number>();
  for (const p of parts) for (const i of [...p.issues, ...p.rows]) if (!order.has(i.file)) order.set(i.file, order.size);
  const rank = (i: TableIssue): number => order.get(i.file) ?? order.size;
  const all = [...scan, ...resolved.issues].sort((a, b) => rank(a) - rank(b) || a.line - b.line);
  return finish(resolved.byId, rows, all, tables, scan);
}

/** A numbered criterion of a requirements file: its id and where it is written. */
export interface CriterionRef { id: string; file?: string; line: number }

const distance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((cur[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] as number;
};

/**
 * The id that `written` most likely means, or undefined. An id that is in `ids` is returned as it is. Otherwise the
 * id left after removing a leading `R`, `Req` or `Requirement` word and a trailing period, then the one id at the
 * smallest edit distance (at most 2 and at most half the length). Two ids at the same distance give no suggestion,
 * because a hint that is a guess is worse than none.
 */
export function nearestId(written: string, ids: readonly string[]): string | undefined {
  if (ids.includes(written)) return written;
  const norm = written.trim().replace(/^(?:requirement|req|r)[\s.:_-]*(?=\d)/i, '').replace(/[.\s]+$/, '');
  if (ids.includes(norm)) return norm;
  const limit = Math.min(2, Math.floor(written.length / 2));
  let best: string | undefined;
  let bestD = limit + 1;
  let tied = false;
  for (const id of new Set(ids)) {
    const d = distance(written, id);
    if (d < bestD) { best = id; bestD = d; tied = false; } else if (d === bestD && best !== undefined) tied = true;
  }
  return tied ? undefined : best;
}

/**
 * Compares the rows with the criteria that exist. A row for an id that no criterion has is an error (the mark would
 * be dropped silently). When a table exists, a criterion with no row is a warning (it is Expected_Hold).
 */
export function reconcileExpectations(parsed: ParsedExpectations, criteria: readonly CriterionRef[]): ParsedExpectations {
  const ids = criteria.map((c) => c.id);
  const known = new Set(ids);
  const issues = [...parsed.issues];
  for (const r of parsed.rows) {
    if (known.has(r.id)) continue;
    const near = nearestId(r.id, ids);
    issues.push({
      severity: 'error', line: r.line, ...(r.file !== undefined ? { file: r.file } : {}),
      message: `the table marks ${r.id}, but no requirement has that id${near !== undefined ? ` (did you mean ${near}?)` : ''}`,
    });
  }
  if (parsed.tables > 0) {
    const marked = new Set(parsed.rows.map((r) => r.id));
    const reported = new Set<string>();
    for (const c of criteria) {
      if (marked.has(c.id) || reported.has(c.id)) continue;
      reported.add(c.id);
      issues.push({
        severity: 'warning', line: c.line, ...(c.file !== undefined ? { file: c.file } : {}),
        message: `${c.id} has no row in the Expectation table, so it is ${DEFAULT_EXPECTATION}`,
      });
    }
  }
  return finish(parsed.byId, parsed.rows, issues, parsed.tables, parsed.scanIssues);
}

/**
 * The table of the files whose text is in `texts`, in `files` order: the only way the kit reads a table. With
 * `reconcile` (the default) it is compared with the criteria of the same texts.
 */
export function readExpectations(
  texts: Readonly<Record<string, string>>, files: readonly string[], o: { reconcile?: boolean } = {},
): ParsedExpectations {
  const present = files.filter((f) => Object.prototype.hasOwnProperty.call(texts, f));
  const merged = mergeExpectations(present.map((f) => parseExpectations(texts[f] as string, f)));
  if (o.reconcile === false) return merged;
  const criteria = present.flatMap((f) => extractCriteria(texts[f] as string).criteria.map((c) => ({ id: c.id, file: f, line: c.line })));
  return reconcileExpectations(merged, criteria);
}

export const expectationOf = (m: ReadonlyMap<string, Expectation>, id: string): Expectation => m.get(id) ?? DEFAULT_EXPECTATION;

/** A requirement whose effective expectation (a row, or the default) differs between two versions of the tables. */
export interface MarkChange { id: string; from: Expectation; to: Expectation }

/** `1.2: Expected_Hold -> Expected_Break (uncommitted)`. */
export const markChangeText = (c: MarkChange): string => `${c.id}: ${c.from} -> ${c.to} (uncommitted)`;

/** The ids whose effective expectation differs, each once: ids of `after` in file order, then ids only `before` names. */
export function diffExpectations(before: Pick<ParsedExpectations, 'byId' | 'rows'>, after: Pick<ParsedExpectations, 'byId' | 'rows'>): MarkChange[] {
  const ids = [...new Set([...after.rows.map((r) => r.id), ...before.rows.map((r) => r.id)])];
  const out: MarkChange[] = [];
  for (const id of ids) {
    const from = expectationOf(before.byId, id);
    const to = expectationOf(after.byId, id);
    if (from !== to) out.push({ id, from, to });
  }
  return out;
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
  met: boolean;
  /** Why it is not met; empty when it is. */
  miss: string;
}

/** Pairs every outcome with its expectation and whether the verdict meets it. */
export function judgeOutcomes(outcomes: readonly RequirementOutcome[], byId: ReadonlyMap<string, Expectation>): Judged[] {
  return outcomes.map((outcome) => {
    const expectation = expectationOf(byId, outcome.verdict.reqId);
    return {
      outcome, expectation,
      met: meetsExpectation(outcome.verdict.status, expectation),
      miss: expectationMiss(outcome.verdict.status, expectation, outcome.verdict.trials),
    };
  });
}
