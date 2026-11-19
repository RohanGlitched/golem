// Pure analysis of falsifier.jsonl, as registered in PREREG.md (Experiment 1).
import { clopperPearson, iqr, median, wilcoxonSignedRank } from './stats.js';

export type Arm = 'guided' | 'random';

export interface FalsifierRecord {
  app: string;
  reqId: string;
  arm: Arm;
  searchSeed: number;
  attempt: number;
  budget: number;
  status: 'held' | 'broken' | 'error';
  /** null when the run errored. */
  found: boolean | null;
  trialsToFirst: number | null;
  sevFound: number | null;
  sevShrunk: number | null;
  robustness: number | null;
  trials: number;
  wallMs: number;
  [k: string]: unknown;
}

/** Ids of the lines marked Expected_Break in the requirements table (`| 1.2 | Topic | Expected_Break |`). */
export function expectedBreaks(markdown: string): string[] {
  const ids: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\|\s*([0-9]+(?:\.[0-9]+)*)\s*\|[^|]*\|\s*Expected_Break\s*\|/.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

export const recordKey = (r: Pick<FalsifierRecord, 'app' | 'reqId' | 'arm' | 'searchSeed'>): string => `${r.app}|${r.reqId}|${r.arm}|${r.searchSeed}`;

/** The last attempt of each key wins (a rerun after an error replaces the error). */
export function latestAttempts(records: readonly FalsifierRecord[]): FalsifierRecord[] {
  const m = new Map<string, FalsifierRecord>();
  for (const r of records) {
    const prev = m.get(recordKey(r));
    if (prev === undefined || r.attempt >= prev.attempt) m.set(recordKey(r), r);
  }
  return [...m.values()];
}

export interface ArmSummary {
  n: number;
  found: number;
  rate: number;
  ci95: { lo: number; hi: number };
  /** Trials to the first counterexample, censored at budget + 1 when none was found. */
  trialsMedian: number;
  trialsIqr: number;
  /** Lowest failing severity, censored at 1 when none was found. */
  sevMedian: number;
  sevIqr: number;
  /** Guided arm: severity after shrinking, among found runs. */
  sevShrunkMedian: number | null;
  wallMsMedian: number;
}

export interface TestSummary { n: number; wPlus: number; wMinus: number; p: number; pBonferroni: number }

export interface ReqSummary {
  app: string;
  reqId: string;
  guided: ArmSummary;
  random: ArmSummary;
  pairs: number;
  excluded: number;
  trialsTest: TestSummary;
  sevTest: TestSummary;
}

function armSummary(rs: readonly FalsifierRecord[], budget: number): ArmSummary {
  const ok = rs.filter((r) => r.found !== null);
  const found = ok.filter((r) => r.found === true).length;
  const trials = ok.map((r) => (r.found ? (r.trialsToFirst ?? budget + 1) : budget + 1));
  const sev = ok.map((r) => (r.found ? (r.sevFound ?? 1) : 1));
  const shrunk = ok.flatMap((r) => (r.found && r.sevShrunk !== null ? [r.sevShrunk] : []));
  return {
    n: ok.length,
    found,
    rate: ok.length === 0 ? NaN : found / ok.length,
    ci95: ok.length === 0 ? { lo: NaN, hi: NaN } : clopperPearson(found, ok.length),
    trialsMedian: median(trials), trialsIqr: iqr(trials),
    sevMedian: median(sev), sevIqr: iqr(sev),
    sevShrunkMedian: shrunk.length === 0 ? null : median(shrunk),
    wallMsMedian: median(ok.map((r) => r.wallMs)),
  };
}

export function summarizeFalsifier(all: readonly FalsifierRecord[], budget: number): ReqSummary[] {
  const recs = latestAttempts(all);
  const keys = [...new Set(recs.map((r) => `${r.app}|${r.reqId}`))].sort();
  const m = keys.length;
  return keys.map((k) => {
    const [app, reqId] = k.split('|') as [string, string];
    const mine = recs.filter((r) => r.app === app && r.reqId === reqId);
    const g = new Map(mine.filter((r) => r.arm === 'guided').map((r) => [r.searchSeed, r]));
    const rnd = new Map(mine.filter((r) => r.arm === 'random').map((r) => [r.searchSeed, r]));
    const seeds = [...new Set([...g.keys(), ...rnd.keys()])].sort((a, b) => a - b);
    const pairs = seeds.flatMap((s) => {
      const a = g.get(s), b = rnd.get(s);
      return a && b && a.found !== null && b.found !== null ? [{ a, b }] : [];
    });
    const val = (r: FalsifierRecord, f: 'trialsToFirst' | 'sevFound', cens: number): number => (r.found ? (r[f] ?? cens) : cens);
    const test = (f: 'trialsToFirst' | 'sevFound', cens: number): TestSummary => {
      const w = wilcoxonSignedRank(pairs.map((x) => val(x.a, f, cens)), pairs.map((x) => val(x.b, f, cens)));
      return { n: w.n, wPlus: w.wPlus, wMinus: w.wMinus, p: w.p, pBonferroni: Math.min(1, w.p * m) };
    };
    return {
      app, reqId,
      guided: armSummary([...g.values()], budget),
      random: armSummary([...rnd.values()], budget),
      pairs: pairs.length,
      excluded: seeds.length - pairs.length,
      trialsTest: test('trialsToFirst', budget + 1),
      sevTest: test('sevFound', 1),
    };
  });
}