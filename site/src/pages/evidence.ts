// Evidence: the G1 stability map, the falsifier benchmark (honest), the candy measurement, the pending agent-gate experiment, methods and limits.
import type { FalsifierSummary, SiteData } from '../build/data';
import { codeBlock, esc, fmt, inlineMd, table } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { polarFigure } from '../figures/polar-figure';
import { ringStats, sideName } from '../figures/rings';

export interface NeedleRow { margin: string; budget: number; randomFound: number; fullFound: number; n: number }

/** Reads the synthetic-needle probe (docs/reviews/falsify-hardening-runs/after-search.txt), block "(1b)": a 0.11 % region. */
export function parseNeedle(text: string): NeedleRow[] {
  const block = text.replace(/\r/g, '').split(/^--- /m).find((b) => b.startsWith('(1b)')) ?? '';
  const rows = new Map<string, Partial<NeedleRow>>();
  for (const l of block.split('\n')) {
    const m = /^(graded|flat)\s+T=(\d+)\s+(random-only|full)\s+found (\d+)\/(\d+)/.exec(l.trim());
    if (!m) continue;
    const key = `${m[1]}|${m[2]}`;
    const r = rows.get(key) ?? { margin: m[1] as string, budget: Number(m[2]), n: Number(m[5]) };
    if (m[3] === 'full') r.fullFound = Number(m[4]); else r.randomFound = Number(m[4]);
    rows.set(key, r);
  }
  const out = [...rows.values()].filter((r): r is NeedleRow => r.fullFound !== undefined && r.randomFound !== undefined);
  if (out.length === 0) throw new Error('docs/reviews/falsify-hardening-runs/after-search.txt: no "(1b)" needle rows found');
  return out;
}

/** The bullets of a "## <title>" section of evidence/REPORT.md. */
export function reportBullets(md: string, title: string): string[] {
  const m = new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(md);
  if (!m) throw new Error(`evidence/REPORT.md has no "## ${title}" section`);
  return [...(m[1] as string).matchAll(/^- (.+)$/gm)].map((x) => x[1] as string);
}

const runs = (s: FalsifierSummary): number => s.summary.reduce((a, r) => a + r.guided.n + r.random.n, 0);
const rate = (a: { found: number; n: number }): string => `${a.found}/${a.n}`;
const ci = (a: { ci95: { lo: number; hi: number } }): string => `${Math.round(a.ci95.lo * 100)}% to ${Math.round(a.ci95.hi * 100)}%`;

function roundTable(label: string, s: FalsifierSummary): string {
  const rows = s.summary.map((r) => [
    esc(r.reqId), rate(r.guided), ci(r.guided), rate(r.random), ci(r.random), fmt(r.guided.trialsMedian), fmt(r.random.trialsMedian), r.trialsTest.pBonferroni.toFixed(2),
  ]);
  return table(['Line', 'Guided found', 'Guided 95% CI', 'Random found', 'Random 95% CI', 'Guided trials to first', 'Random trials to first', 'p (Bonferroni)'], rows,
    { caption: `${label}: budget ${s.meta.budget}, ${s.meta.searchSeeds} search seeds per arm, ${runs(s)} runs`, num: [1, 3, 5, 6, 7] });
}

/** Success rate of both arms on one line, both rounds, as bars. The table next to it has every number. */
function bars(rows: { label: string; found: number; n: number; cls: 'g' | 'r' }[]): string {
  const cells = rows.map((r) => `<span>${esc(r.label)}</span><span class="bar"><i class="${r.cls}" style="width:${(100 * r.found / r.n).toFixed(1)}%"></i></span><span class="mono">${r.found}/${r.n}</span>`).join('');
  return `<div class="bars" role="img" aria-label="${esc(rows.map((r) => `${r.label}: ${r.found} of ${r.n}`).join('; '))}">${cells}</div>`;
}

export function evidencePage(d: SiteData): PageSpec {
  const m = d.map.meta;
  const r13a = d.falsifier.summary.find((r) => r.reqId === '1.3');
  const r13b = d.graded.summary.find((r) => r.reqId === '1.3');
  if (!r13a || !r13b) throw new Error('falsifier summaries have no row for line 1.3');
  const needle = parseNeedle(d.needleRuns);
  const needleHard = needle.find((r) => r.margin === 'graded' && r.budget === 400);
  const needleFlat = needle.find((r) => r.margin === 'flat' && r.budget === 1000);
  if (!needleHard) throw new Error('needle rows lack the graded budget-400 case');
  const hasG256 = d.graded256 !== undefined;
  const limits = reportBullets(d.reportMd, 'Limits');
  const candyParas = d.candy.paragraphs.map((p) => {
    const parts = p.split(/(?:^|\s)- (?=[A-Z])/);
    if (parts.length < 2) return `<p>${inlineMd(p)}</p>`;
    const [head, ...items] = parts;
    return `${head ? `<p>${inlineMd(head)}</p>` : ''}<ul>${items.map((i) => `<li>${inlineMd(i.trim())}</li>`).join('')}</ul>`;
  }).join('');

  const g256 = d.graded256;
  const roundRows = [
    { label: 'Round 1 guided', found: r13a.guided.found, n: r13a.guided.n, cls: 'g' as const },
    { label: 'Round 1 random', found: r13a.random.found, n: r13a.random.n, cls: 'r' as const },
    { label: 'Round 2 guided', found: r13b.guided.found, n: r13b.guided.n, cls: 'g' as const },
    { label: 'Round 2 random', found: r13b.random.found, n: r13b.random.n, cls: 'r' as const },
  ];
  const r13c = g256?.summary.find((r) => r.reqId === '1.3');
  if (r13c) roundRows.push({ label: 'Round 3 guided', found: r13c.guided.found, n: r13c.guided.n, cls: 'g' }, { label: 'Round 3 random', found: r13c.random.found, n: r13c.random.n, cls: 'r' });
  const needleRows = needle.map((r) => [r.margin === 'flat' ? 'flat (fall = fixed margin)' : 'graded (height and tilt headroom)', String(r.budget), `${r.randomFound}/${r.n}`, `${r.fullFound}/${r.n}`]);
  const gate = d.agentGate;

  const body = `
<h1>Evidence</h1>
<p class="lede">Every number here comes from a committed raw file. Each section says what was run, with what budget, and what it does not show.</p>
<p>The plan was fixed in <a href="${REPO_URL}/blob/main/evidence/PREREG.md">the pre-registration</a> before the campaigns ran. The generated <a href="${REPO_URL}/blob/main/evidence/REPORT.md">report</a> holds the full tables.</p>

<h2 id="map">The G1 stability map</h2>
<p>For each push direction and stride phase, the largest 0.2 s pelvis push the Unitree G1 survives for 3 s. The weakest direction is ${m.weakest.dirDeg}° at ${fmt(m.weakest.minHeldN)} N (stride phase ${m.weakest.weakestPhase}). The strongest is ${m.strongest.dirDeg}° at ${fmt(m.strongest.minHeldN)} N. That is a factor of ${fmt(m.strongest.minHeldN / m.weakest.minHeldN)}.</p>
<section class="bleed" aria-label="G1 stability map"><div class="bleed-in">${polarFigure(d.mapCells, d.map)}</div></section>
<p>Each cell is a bisection on force (one trial at 400 N, then 8 steps), and every trial is deterministic given its scenario and seed. An earlier run, made before the push direction reached the simulator, gave the same boundary in every direction. It is kept as invalid in <code>evidence/results/invalid/</code> and is not used.</p>

${kiroReflexSection(d)}
<h2 id="benchmark">The falsifier benchmark</h2>
<p><b>Result: on these G1 lines, guided search found counterexamples no more often and no sooner than random sampling.</b> Both arms ran the same 4 lines that are written to break, with the same 20 search seeds, at budget ${d.falsifier.meta.budget}.</p>
<h3>Round 1: the fall margin was flat</h3>
<p>A fall scored a fixed −0.01 m, so guided search had no slope to follow.</p>
${roundTable('Round 1', d.falsifier)}
<h3>Round 2: a graded margin</h3>
<p>The upright margin was changed to height and tilt headroom, with the same verdict. The picture did not change.</p>
${roundTable('Round 2', d.graded)}
<h3>Round 3: budget 256</h3>
${g256 ? roundTable('Round 3', g256) : `<p class="pending">Not run. There is no <code>evidence/results/graded-margin-256/</code> in this repository, so this page reports no budget-256 result.</p>`}
<figure>
${bars(roundRows)}
<figcaption>Line 1.3 (100 N from any direction), the only line where the arms can differ: share of 20 seeds that found a counterexample. Guided is the pale bar, random the clay bar. Lines 1.2, 4.2 and 6.2 are found by every run of both arms in the first generations, so they cannot separate the arms.</figcaption>
</figure>
<h3>Where guided search does win: a synthetic needle</h3>
<p>The falsify-hardening audit ran a synthetic test with a failing region of 0.11% of the scenario space (angle 130° to 135°, force above 230 N). With the graded margin at budget 400, GOLEM found it in ${needleHard.fullFound}/${needleHard.n} runs and random sampling in ${needleHard.randomFound}/${needleHard.n}.</p>
${table(['Margin shape', 'Budget', 'Random found', 'GOLEM found'], needleRows, { caption: 'Needle of 0.11% of the space, 30 seeds per row. Source: docs/reviews/falsify-hardening-runs/after-search.txt', num: [1, 2, 3] })}
${needleFlat ? `<p>The flat-margin row is the defect that round 1 hit on the G1: with no slope, GOLEM found ${needleFlat.fullFound}/${needleFlat.n} against ${needleFlat.randomFound}/${needleFlat.n} for random.</p>` : ''}
<p>So the search works where a region is narrow and the margin has a slope. The G1 lines at budget ${d.graded.meta.budget} are either too easy or too small to show it.</p>

<h2 id="candy">The candy measurement</h2>
<p>Line ${esc(d.candy.line)} of the Panda sorter: the arm keeps every link at least 0.10 m from the hand. ${d.candy.broken} of ${d.candy.trials} trials break it. The worst case is ${fmt(d.candy.worstMinDistanceM, 3)} m. The closest link is the wrist (link7) in ${d.candy.closestLinkAtBreak['link7'] ?? 0} breaks and the cup in ${d.candy.closestLinkAtBreak['cup'] ?? 0}.</p>
<p>The arm's speed-and-separation controller (SSM v1) slows and then stops the arm by the suction cup's distance to the hand. While the cup was still at least 0.40 m away, no link came closer than 0.259 m, so the arm never swung its body into a hand early. The breaks happen at the end of the slowdown: the arm stops with the cup about 0.14 m from the hand and the wrist inside 0.10 m. A fix would measure the separation from every link, not only the cup; that fix has not been made, so line 1.1 stays broken on purpose.</p>
<p>Hands enter from the doorstep side only (an arc of 120° on the table edge facing away from the base), at 0.05 m to 0.25 m above the table and 0.8 m/s. An earlier straight-line path model let a hand pass through the robot's base column, which said nothing about the controller, so it was replaced. 108 trials sit on a grid over the arc ends and middle, 3 heights and 3 entry times; 120 are random.</p>
<details><summary>The full measurement notes</summary>${candyParas}</details>
<p class="small muted">Source: ${esc(d.candy.heading)}, <a href="${REPO_URL}/blob/main/apps/candy/proposals.md"><code>apps/candy/proposals.md</code></a> P8, raw rows in <code>evidence/results/candy-p8-doorstep.jsonl</code>, at commit <code>${esc(d.candy.source.commit.slice(0, 7))}</code>.</p>

<h2 id="agent-gate">Does the Stop gate stop false "done" claims?</h2>
<p class="pending">Pending. The experiment has not been run.</p>
<p>The harness exists and is tested. It needs the owner's approval before it spends credits: 6 runs per arm, hard cap ${gate.cap} credits. Two dry runs checked the plumbing and are excluded from any analysis: arm A used ${gate.dryRuns.find((r) => r.arm === 'A')?.credits.toFixed(2)} credits and arm B ${gate.dryRuns.find((r) => r.arm === 'B')?.credits.toFixed(2)}. The independent gate on the untouched G1 app exits ${gate.baseline.gateExit} (red), so the experiment starts from a failing controller. This page makes no claim about the gate's effect on agents.</p>

<h2 id="methods">Methods</h2>
<ul>
<li><b>Verdicts</b> come from deterministic monitors with quantitative robustness. No language model decides anything.</li>
<li><b>Falsifier benchmark:</b> ${runs(d.falsifier)} runs in round 1 and ${runs(d.graded)} in round 2. Success rates carry exact Clopper-Pearson 95% intervals. Trials to the first counterexample are compared with a paired exact Wilcoxon signed-rank test, with a Bonferroni adjustment for 4 lines.</li>
<li><b>Map:</b> ${m.dirs} directions × ${m.phases} stride phases × ${m.seeds} seeds, ${m.trials.toLocaleString('en-US')} trials, ${fmt(m.seconds / 60)} minutes. A 30-cell spot check re-ran from the rebuilt script and matched the committed rows exactly.</li>
<li><b>Pre-registration:</b> <a href="${REPO_URL}/blob/main/evidence/PREREG.md"><code>evidence/PREREG.md</code></a>. One prediction in it was wrong (line 1.3 was expected to be easy to find), and the report says so.</li>
<li><b>Reproduce:</b> the raw rows are in <code>evidence/results/</code> and the scripts in <code>evidence/scripts/</code>.</li>
</ul>

<h2 id="limits">Limits</h2>
<ul>${limits.map((l) => `<li>${inlineMd(l)}</li>`).join('')}</ul>
<p>A "held" verdict always means no counterexample within the stated budget. This is simulation, not a real robot.</p>
`;
  return {
    id: 'evidence', path: '/evidence/', title: 'Evidence',
    description: `The G1 stability map (weakest ${fmt(m.weakest.minHeldN)} N at ${m.weakest.dirDeg} deg), an honest falsifier benchmark, the candy wrist finding, methods and limits.`,
    body, modules: ['/src/client/polar.ts'],
  };
}

/** The same map with the reflex Kiro's golem-tuner agent wrote, direction by direction. */
function kiroReflexSection(d: SiteData): string {
  if (!d.mapKiro) return '<h2 id="kiro-reflex">With Kiro’s reflex</h2><p class="pending">The map with Kiro’s reflex has not been committed yet.</p>';
  const a = d.map.summary, b = d.mapKiro.summary.summary;
  const sa = ringStats(a, 100), sb = ringStats(b, 100);
  const byDir = new Map(b.map((x) => [x.dirDeg, x]));
  const rows = [...a].sort((x, y) => x.dirDeg - y.dirDeg).map((x) => {
    const y = byDir.get(x.dirDeg);
    const delta = y ? y.minHeldN - x.minHeldN : NaN;
    return [`${x.dirDeg}°`, sideName(x.dirDeg), fmt(x.minHeldN), y ? fmt(y.minHeldN) : '–', Number.isFinite(delta) ? `${delta >= 0 ? '+' : ''}${fmt(delta)}` : '–'];
  });
  return `<h2 id="kiro-reflex">With Kiro’s reflex</h2>
<p>The same campaign (${d.mapKiro.summary.meta.cells} cells, ${d.mapKiro.summary.meta.trials} trials) with <code>GOLEM_REFLEX=kiro</code>: the lateral step-into-the-push reflex that Kiro’s <code>golem-tuner</code> agent wrote to make requirement 1.3 hold. Unitree’s policy, the PD law and the model are unchanged; the reflex only rewrites the velocity command the policy sees.</p>
<div class="stats">
<div class="stat"><b class="hold">${fmt(sa.weakest.minHeldN)} → ${fmt(sb.weakest.minHeldN)} N</b><span>Weakest push survived (${sa.weakest.dirDeg}° before, ${sb.weakest.dirDeg}° after).</span></div>
<div class="stat"><b>${sa.holding} → ${sb.holding}</b><span>Directions of ${sa.dirs} that hold 100 N.</span></div>
<div class="stat"><b class="break">${fmt(sa.strongest.minHeldN)} → ${fmt(sb.strongest.minHeldN)} N</b><span>Strongest direction (${sa.strongest.dirDeg}° before, ${sb.strongest.dirDeg}° after). The largest loss is at the front, where the reflex trades a little headroom for the sides.</span></div>
</div>
<details><summary>All ${rows.length} directions, weakest push survived in newtons</summary>
${table(['Direction', 'Pushed from', 'Unitree only', 'With Kiro’s reflex', 'Change'], rows, { num: [2, 3, 4], caption: 'Minimum over 5 stride phases and 3 seeds. Raw cells: evidence/results/g1-map.jsonl and evidence/results/kiro-reflex/g1-map.jsonl.' })}
</details>
<p>The agent’s session log and prompt are in <a href="${REPO_URL}/tree/main/evidence/results/tuner"><code>evidence/results/tuner/</code></a>. It checked its work with GOLEM’s MCP tools and <code>golem gate</code>; this map is a separate re-measurement afterwards, over all 36 directions, 5 stride phases and 3 seeds.</p>`;
}
