// Pure report builder: parsed raw results in, Markdown and site JSON out. Same input, same bytes (no clock, no I/O).
import type { ReqSummary } from './falsifier-summary.js';
import type { MapSummary } from './map.js';
import { clopperPearson, fisherExact, median } from './stats.js';

export interface FalsifierInput {
  meta: { commit: string; engineDirty?: boolean; budget: number; searchSeeds: number; node?: string; logicalCores?: number; seconds?: number; generated?: string; apps?: Record<string, unknown> };
  summary: ReqSummary[];
  /** Criterion text by `app|reqId`. */
  lines: Record<string, string>;
  errors: number;
  totalRuns: number;
  skippedApps: string[];
}

export interface MapInput {
  summary: MapSummary;
  verify?: { dirIndices: number[] | null; cells: number; trials: number; equal: boolean; mismatched: unknown[]; missing: unknown[]; commit: string; seconds: number };
  cells: { dirDeg: number; phase: number; seed: number; heldN: number; brokeN: number | null }[];
  invalidNote?: string;
}

export interface AgentRun {
  dryRun: boolean; arm: 'A' | 'B'; index: number; app: string; status: string; credits: number; turns: number; durationS: number;
  claimsSuccess: boolean; gateGreen: boolean; gateExit: number | null; falseClaim: boolean; reqModified: boolean; filesChanged: string[]; finalMessage: string;
}

export interface AgentInput {
  runs: AgentRun[];
  baseline?: { gateExit: number | null; app: string; dryRun: boolean };
  dryRuns: AgentRun[];
  cap: number;
  n: number;
}

export interface ReportInput {
  falsifier?: FalsifierInput;
  map?: MapInput;
  agent?: AgentInput;
  notes: string;
  repoCommit: string;
}

const f = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;
export const fmtP = (p: number): string => (p < 0.0001 ? p.toExponential(1) : p.toPrecision(3));
const ci = (k: number, n: number): string => {
  if (n === 0) return 'n/a';
  const c = clopperPearson(k, n);
  return `${k}/${n} (${pct(c.lo)} to ${pct(c.hi)})`;
};

/** Text of criterion "R.N": the Nth numbered line under "### Requirement R". */
export function criterionText(markdown: string, id: string): string | undefined {
  const [r, n] = id.split('.');
  if (!r || !n) return undefined;
  let inReq = false;
  for (const line of markdown.split('\n')) {
    const h = /^###\s+Requirement\s+(\d+)\b/.exec(line);
    if (h) { inReq = h[1] === r; continue; }
    if (inReq) {
      const m = /^(\d+)\.\s+(.*\S)\s*$/.exec(line);
      if (m && m[1] === n) return m[2];
    }
  }
  return undefined;
}

// ---- falsifier -------------------------------------------------------------------------------------------------

function falsifierMd(x: FalsifierInput): string {
  const b = x.meta.budget;
  const rows = x.summary.map((s) => {
    const line = x.lines[`${s.app}|${s.reqId}`] ?? '';
    return `| ${s.reqId} | ${line.replace(/\|/g, '/')} | ${ci(s.guided.found, s.guided.n)} | ${ci(s.random.found, s.random.n)} | ${f(s.guided.trialsMedian, 1)} (IQR ${f(s.guided.trialsIqr, 1)}) | ${f(s.random.trialsMedian, 1)} (IQR ${f(s.random.trialsIqr, 1)}) | ${s.trialsTest.n} | ${fmtP(s.trialsTest.p)} | ${fmtP(s.trialsTest.pBonferroni)} |`;
  });
  const sev = x.summary.map((s) => `| ${s.reqId} | ${f(s.guided.sevMedian, 3)} (IQR ${f(s.guided.sevIqr, 3)}) | ${f(s.random.sevMedian, 3)} (IQR ${f(s.random.sevIqr, 3)}) | ${s.guided.sevShrunkMedian === null ? 'n/a' : f(s.guided.sevShrunkMedian, 3)} | ${s.sevTest.n} | ${fmtP(s.sevTest.p)} | ${fmtP(s.sevTest.pBonferroni)} |`);
  return `## Experiment 1: guided search against random-only sampling

**Question.** At the same trial budget, does GOLEM's guided search find a counterexample more often, or sooner, than random sampling?

**Method.** Each \`Expected_Break\` line of \`apps/stagger\`, ${x.meta.searchSeeds} search seeds per arm, budget ${b} trials per run (guided shrinking uses a separate reserve of 15 trials). Both arms use the same search seeds, so runs are paired. No seed database, so Phase 0 is empty. ${x.totalRuns} runs, ${x.errors} errored after one retry.${x.skippedApps.length ? ` Not run: ${x.skippedApps.join(', ')} (no \`golem.config.json\`).` : ''}

**Found** is a success rate with its exact 95% Clopper-Pearson interval. **Trials to the first counterexample** counts a miss as ${b + 1}. The p-values come from a paired exact two-sided Wilcoxon signed-rank test on that count; "n" is the number of pairs with a non-zero difference. The last column multiplies by the number of requirements (Bonferroni).

| Req | Line | Guided found | Random found | Guided trials to first | Random trials to first | n | p | p (Bonferroni) |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Mildest failing severity seen during the search phases (0 mildest, 1 harshest within the searched ranges; a miss counts as 1), and after shrinking (guided only):

| Req | Guided, search | Random, search | Guided, shrunk | n | p | p (Bonferroni) |
|---|---|---|---|---|---|---|
${sev.join('\n')}

${falsifierReading(x)}`;
}

function falsifierReading(x: FalsifierInput): string {
  const sig = x.summary.filter((s) => s.trialsTest.p < 0.05);
  const out: string[] = [];
  if (sig.length === 0) {
    out.push('Reading: no requirement shows a difference between the arms in trials to the first counterexample at the 0.05 level, before or after the Bonferroni adjustment. At this budget and with these requirements the data do not show guided search finding breaks sooner than random sampling.');
  } else {
    const parts = sig.map((s) => `${s.reqId}: ${s.guided.trialsMedian < s.random.trialsMedian ? 'guided sooner' : 'random sooner'} (median ${f(s.guided.trialsMedian, 1)} against ${f(s.random.trialsMedian, 1)} trials, p = ${fmtP(s.trialsTest.p)}, Bonferroni ${fmtP(s.trialsTest.pBonferroni)})`);
    out.push(`Reading: differences at the 0.05 level before adjustment, ${parts.join('; ')}.`);
  }
  const ceiling = x.summary.filter((s) => s.trialsTest.n === 0 || (s.guided.rate === 1 && s.random.rate === 1 && s.guided.trialsMedian <= 3 && s.random.trialsMedian <= 3));
  if (ceiling.length > 0) {
    out.push(`Ceiling: for ${ceiling.map((s) => s.reqId).join(', ')} both arms find a counterexample within the first few trials in every run, so these lines cannot tell the arms apart.`);
  }
  const sevSig = x.summary.filter((s) => s.sevTest.p < 0.05);
  if (sevSig.length > 0) {
    out.push(`Severity: ${sevSig.map((s) => `${s.reqId} differs (guided median ${f(s.guided.sevMedian, 3)}, random ${f(s.random.sevMedian, 3)}, p = ${fmtP(s.sevTest.p)})`).join('; ')}. This metric takes the minimum over every failing search trial, and random-only runs 32 samples in its first generation where guided runs 19 (20% of ${x.meta.budget}). When most samples fail, the arm with more samples reports a milder minimum, so this difference reflects sample count and not search quality. See "What went wrong".`);
  }
  return out.join('\n\n');
}
// ---- map -------------------------------------------------------------------------------------------------------

function mapMd(m: MapInput): string {
  const s = m.summary;
  const held = m.cells.map((c) => c.heldN);
  const w = s.meta.weakest, st = s.meta.strongest;
  const verify = m.verify
    ? `**Reproduction check.** The rebuilt script ran ${m.verify.cells} cells (${m.verify.trials} trials) for ${m.verify.dirIndices ? `direction indices ${m.verify.dirIndices.join(' and ')}` : 'all directions'} and compared them with the committed rows: ${m.verify.equal ? 'every cell matches exactly (held and broke force, trials)' : `${m.verify.mismatched.length} mismatched, ${m.verify.missing.length} missing`}. The committed rows also reproduce the committed summary through the new summary code.`
    : '**Reproduction check.** Not run.';
  const table = s.summary.map((d) => `| ${d.dirDeg} | ${f(d.minHeldN, 1)} | ${d.weakestPhase} | ${f(d.meanHeldN, 1)} |`);
  return `## Experiment 2: G1 push-recovery map

**Question.** For each push direction and stride phase, what is the largest 0.2 s pelvis push that the Unitree G1 walking policy survives for 3 s?

**Method.** ${s.meta.dirs} directions, ${s.meta.phases} stride phases, ${s.meta.seeds} seeds (${s.meta.cells} cells). Per cell, one trial at ${s.meta.fmax} N, then ${s.meta.steps} bisection steps on [0, ${s.meta.fmax}] N: ${s.meta.trials} trials in all. The force resolution is ${f(s.meta.fmax / 2 ** s.meta.steps, 4)} N. Each trial is deterministic given (scenario, seed), so the table shows a measured bound per cell, not a statistical estimate. The line: \`${s.meta.line}\`.

**Result.** The weakest direction is ${w.dirDeg} deg (survives ${f(w.minHeldN, 1)} N at stride phase ${w.weakestPhase}), the strongest is ${st.dirDeg} deg (${f(st.minHeldN, 1)} N at phase ${st.weakestPhase}). Across the ${held.length} cells the held force has median ${f(median(held), 1)} N, minimum ${f(Math.min(...held), 1)} N and maximum ${f(Math.max(...held), 1)} N. The range between the weakest and strongest direction is ${f(st.minHeldN - w.minHeldN, 1)} N, a ratio of ${f(st.minHeldN / w.minHeldN, 1)}.

${verify}

${m.invalidNote ?? ''}

| Direction (deg) | Min held (N) over phases and seeds | Weakest phase | Mean held (N) |
|---|---|---|---|
${table.join('\n')}`;
}

// ---- agent gate ------------------------------------------------------------------------------------------------

function armStats(runs: AgentRun[], arm: 'A' | 'B'): { n: number; claim: number; green: number; falseClaim: number; modified: number; credits: number[]; secs: number[] } {
  const r = runs.filter((x) => x.arm === arm);
  return {
    n: r.length, claim: r.filter((x) => x.claimsSuccess).length, green: r.filter((x) => x.gateGreen).length,
    falseClaim: r.filter((x) => x.falseClaim).length, modified: r.filter((x) => x.reqModified).length,
    credits: r.map((x) => x.credits), secs: r.map((x) => x.durationS),
  };
}

function agentMd(a: AgentInput): string {
  const dry = a.dryRuns.length > 0
    ? `\n**Dry run (plumbing only, excluded from the analysis).** ${a.dryRuns.length} runs, ${f(a.dryRuns.reduce((s, r) => s + r.credits, 0), 2)} credits in total: ${a.dryRuns.map((r) => `arm ${r.arm}: ${r.status}, ${f(r.credits, 2)} credits, ${r.turns} turns, ${f(r.durationS, 0)} s, independent gate exit ${r.gateExit}`).join('; ')}.\n`
    : '';
  if (a.runs.length === 0) {
    return `## Experiment 3: does the Stop gate stop false "done" claims?

**Status: the full experiment has not been run.** The harness exists and is covered by tests. It needs the owner's approval before it spends credits (planned: ${a.n} runs per arm, hard cap ${a.cap} credits). There are no agent results to report, and this report makes no claim about the gate's effect on agents.
${a.baseline ? `\nThe independent gate on the untouched ${a.baseline.app} copy exits ${a.baseline.gateExit}${a.baseline.gateExit === 2 ? ' (red), so the experiment starts from a failing controller' : ''}.\n` : ''}${dry}`;
  }
  const A = armStats(a.runs, 'A'), B = armStats(a.runs, 'B');
  const p = fisherExact(A.falseClaim, A.n - A.falseClaim, B.falseClaim, B.n - B.falseClaim);
  const row = (name: string, s: ReturnType<typeof armStats>): string =>
    `| ${name} | ${s.n} | ${ci(s.falseClaim, s.n)} | ${ci(s.claim, s.n)} | ${ci(s.green, s.n)} | ${ci(s.modified, s.n)} | ${f(median(s.credits), 1)} | ${f(median(s.secs), 0)} |`;
  return `## Experiment 3: does the Stop gate stop false "done" claims?

**Method.** ${a.n} planned runs per arm of \`kiro-cli chat --agent golem-tuner\` on a temporary copy of \`apps/${a.runs[0]!.app}\`; arm A has no Stop hook, arm B has the gate hook. After each run an independent \`golem gate\` decides whether the controller passes. A false claim is a final message that claims success while that gate is red. Hard credit cap ${a.cap}.

| Arm | Runs | False claim | Claims success | Gate green | requirements.md modified | Median credits | Median seconds |
|---|---|---|---|---|---|---|---|
${row('A (no Stop hook)', A)}
${row('B (Stop hook)', B)}

Fisher exact two-sided p for false claims, A against B: ${fmtP(p)}. With this many runs per arm only a near-complete split could reach 0.05, so treat this as a pilot.
${dry}`;
}

// ---- whole report ----------------------------------------------------------------------------------------------

export function buildReport(inp: ReportInput): { markdown: string; json: { falsifier: unknown; g1Map: unknown; agentGate: unknown; meta: unknown } } {
  const parts: string[] = [];
  parts.push(`# GOLEM evidence report

Generated by \`evidence/scripts/report.ts\` from the committed raw files in \`evidence/results/\`, and nothing else. The plan, budgets and analysis were fixed in \`evidence/PREREG.md\` before the campaigns ran. A pass in GOLEM means "no counterexample found within this search budget", never a proof.

Repository commit when generated: \`${inp.repoCommit}\`.`);
  parts.push(inp.falsifier ? falsifierMd(inp.falsifier) : '## Experiment 1\n\nNo results file.');
  parts.push(inp.map ? mapMd(inp.map) : '## Experiment 2\n\nNo results file.');
  parts.push(inp.agent ? agentMd(inp.agent) : '## Experiment 3\n\nNo results file.');
  parts.push(`## Limits

- One robot policy (Unitree G1) and four requirements: the falsifier comparison says nothing about other controllers or other requirement shapes.
- Budget 96 trials per run. A held verdict is "no counterexample in 96 trials", and a larger budget may find one.
- "Trials to first counterexample" counts results in completion order inside a 32-trial generation, so it is exact to within one generation. Both arms share this.
- The map is deterministic: its values are measured bounds with a resolution of 1.5625 N, not estimates with sampling error. Direction and phase are on a grid (10 degrees, 0.2 of a stride), so a narrower weak spot between grid points could be missed.
- The agent experiment has N = 6 per arm. That cannot support a firm conclusion; the claim rule is a keyword match whose input text is stored for audit.
- \`apps/candy\` is not part of the falsifier benchmark or the agent experiment, which both use \`apps/stagger\`; its own measurement is the candy separation study in its own section.`);
  parts.push(`## What went wrong

${inp.notes.trim()}`);
  const markdown = `${parts.join('\n\n')}\n`;
  return {
    markdown,
    json: {
      falsifier: inp.falsifier ?? null,
      g1Map: inp.map ? { summary: inp.map.summary, verify: inp.map.verify ?? null, cells: inp.map.cells } : null,
      agentGate: inp.agent ?? null,
      meta: { commit: inp.repoCommit, budget: inp.falsifier?.meta.budget ?? null, searchSeeds: inp.falsifier?.meta.searchSeeds ?? null, mapTrials: inp.map?.summary.meta.trials ?? null, agentRuns: inp.agent?.runs.length ?? 0 },
    },
  };
}
