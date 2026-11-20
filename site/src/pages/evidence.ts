// Evidence: the G1 stability map, the falsifier benchmark (honest), the candy measurement, the agent-gate pilot, methods and limits.
import type { FalsifierSummary, SiteData } from '../build/data';
import { codeBlock, esc, fmt, inlineMd, table } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { polarFigure } from '../figures/polar-figure';
import { ringStats, sideName } from '../figures/rings';

const PRIOR_ART: string[][] = [["NASA FRET", "Structured English (FRETish) to temporal logic and runtime monitors", "No physics search of its own; exports to analysis tools", "GOLEM reads the EARS lines an AI agent already writes in a Kiro spec, and searches a physics simulation for the scenario that breaks them."], ["S-TaLiRo, Breach", "Signal temporal logic, written by hand", "Robustness-guided falsification of Simulink models in MATLAB", "Same idea of robustness-guided falsification; GOLEM runs it on MuJoCo in Node and the browser, with no MATLAB, and adds shrinking and pinned regression seeds."], ["RTAMT", "STL specifications, written by hand", "Online and offline monitoring (Python, C++)", "A monitor library only; GOLEM compiles its monitors from sentences and drives the search and the gate."], ["VerifAI with Scenic", "A scenario language", "Falsification with samplers, including cross-entropy, for autonomous vehicles", "The nearest ancestor. GOLEM starts from requirement sentences instead of a scenario program, and gates an AI coding agent on the result."], ["nl2spec, NL2TL", "Free natural language, translated by an LLM", "Translation only", "GOLEM parses a fixed EARS dialect deterministically: no language model decides what a line means or whether it held."], ["Property-based testing (Hypothesis, fast-check)", "Code properties", "Random generation and shrinking", "GOLEM borrows shrinking and seed pinning, and applies them to physics trials stated in a spec."], ["Runtime action gates for robots", "Rules on actions at run time", "Blocks unsafe robot actions while running", "Those gate the robot. GOLEM gates the coding agent's claim that the work is done, before anything ships."], ["EARS-CTRL (Lúcio et al., 2017)", "EARS requirements in a structured editor", "Checks the requirements for consistency and realisability, synthesises a controller and simulates it in Simulink", "The closest on the requirements side. GOLEM does not synthesise; it searches for a scenario that breaks a hand- or agent-written controller, and gates the agent on the result."], ["FRET with CoCoSim, Simulink Requirements Table", "Structured requirements next to a Simulink model", "Generates monitors and test cases from the requirements", "Requirements-based testing in MATLAB toolchains. GOLEM does the same for MuJoCo in Node, the browser and CI, with a search for the worst case instead of fixed test cases."], ["Eureka and other LLM plus simulation loops", "A task description", "A language model writes reward or controller code and keeps what scores best in simulation", "The model judges itself by a score it optimises. In GOLEM the agent never decides the verdict: a fixed monitor does, and the agent cannot finish while a line misses its expectation."], ["FRET, Ogma and Copilot for ROS 2 (Perez et al., 2022)", "Structured-English requirements compiled into hard real-time runtime monitors for ROS 2 robots", "Monitors a running robot; no search for a breaking scenario", "The closest monitor pipeline for robots. GOLEM compiles monitors too, but its job is to search simulation for the scenario that breaks the line, before anything runs, and to gate the agent on it."], ["LLM-Falsifier (2026)", "A language model as the optimiser in STL falsification of cyber-physical systems", "Falsification with an LLM in the loop", "GOLEM's search and verdict are deterministic (LHS, cross-entropy, shrinking) so a result can be replayed from its seed; no model decides whether a line held."], ["Test-driven agentic controller synthesis (2026)", "An agent writes and repairs robot navigation controllers against test suites in Webots", "Fixed test suites written for the task", "The nearest agent loop. GOLEM's tests come from the spec's own sentences, are searched for the worst case rather than run as fixed cases, and the agent cannot finish while one is false."]].map((r) => r.map((c) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;')));

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
<p><b>Why three different "weakest" numbers appear on this site.</b> The map tests a grid: 36 directions, 5 stride phases, 3 seeds. Its 62.5 N is the weakest push on that grid. The falsifier searches between grid points, at any angle, any stride phase and any seed, so it can find a push from about the same side that breaks the line with less force: the CLI transcript's gate shrinks one to 72.1 N at 88.1° and 28 % of the stride, and the golem-tuner's first search found 55.6 N. All three say the same thing: the G1 on Unitree's policy falls from its left well under 100 N.</p>

${kiroReflexSection(d)}
<h2 id="benchmark">The falsifier benchmark</h2>
<p><b>Result: on these G1 lines, guided search found counterexamples no more often and no sooner than random sampling.</b> Both arms ran the same 4 lines that were marked to break at the time (1.2, 1.3, 4.2, 6.2; 1.3 became Expected_Hold on 2026-11-20, after Kiro's reflex), with the same 20 search seeds, at budget ${d.falsifier.meta.budget}.</p>
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
${agentGateSection(d)}
${agentGateHardSection(d)}

<h2 id="prior-art">Prior art, and what GOLEM adds</h2>
<p>None of the pieces is new on its own. Falsifying cyber-physical systems against temporal logic is an established field, and property-based testing gave us shrinking. What is new is the loop: the requirement is the sentence an AI agent wrote in its own spec, the test runs in the browser or in CI with no MATLAB, and the result gates the agent.</p>
${table(['Work', 'Input', 'What it does', 'How GOLEM differs'], PRIOR_ART, { caption: 'Prior art. GOLEM adds no new falsification algorithm; its search is Latin-hypercube sampling, cross-entropy and shrinking.' })}

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

/** Experiment 3: the agent-gate pilot, from site/data/agent-gate.json. */
function agentGateSection(d: SiteData): string {
  const g = d.agentGate;
  const runs = g.runs ?? [];
  if (runs.length === 0) return '<p class="pending">Pending. The experiment has not been run.</p>';
  const arm = (a: string) => runs.filter((r) => r.arm === a);
  const count = (a: string, f: (r: (typeof runs)[number]) => boolean) => `${arm(a).filter(f).length}/${arm(a).length}`;
  const credits = runs.reduce((s, r) => s + r.credits, 0);
  const rows = runs.map((r) => [r.arm === 'A' ? 'A (no Stop hook)' : 'B (Stop hook)', String(r.index + 1), r.gateGreen ? '<span class="held">green</span>' : '<span class="broken">red</span>', r.claimsSuccess ? 'yes' : 'no', r.falseClaim ? '<span class="broken">yes</span>' : 'no', fmt(r.credits, 2), fmt(r.durationS / 60, 1), r.filesChanged.map((f) => `<code>${esc(f)}</code>`).join(' ')]);
  return `<p><b>Result: no false claims in either arm.</b> Without the Stop hook, ${count('A', (r) => r.falseClaim)} runs claimed success while the independent gate was red; with it, ${count('B', (r) => r.falseClaim)}. The task turned out to be one these agents could do: the independent gate was green after ${count('A', (r) => r.gateGreen)} runs without the hook and ${count('B', (r) => r.gateGreen)} with it, each run a single short session, ${fmt(credits, 1)} credits for all ${runs.length}. The one run that left the gate red did not claim success. So the gate had nothing to stop here, and this pilot does not show that it reduces false claims; it shows that on this task neither arm lied. No run edited a requirements file.</p>
<p>The subject started red: the independent gate on the untouched copy exited ${g.baseline.gateExit}. Three deviations from the pre-registration are recorded in <a href="${REPO_URL}/blob/main/evidence/PREREG.md"><code>evidence/PREREG.md</code></a> before the full run: the workspace carries the pinned seeds (restored before every independent gate), the subject stays <code>apps/stagger</code>, and Kiro's later reflex is replaced by the identity reflex so the controller is the one the plan registered. "Claims success" is the pre-registered keyword rule; several green runs phrased success in words the rule does not match, and their messages are stored for audit.</p>
${table(['Arm', 'Run', 'Independent gate', 'Claims success', 'False claim', 'Credits', 'Minutes', 'Files the agent changed'], rows, { num: [5, 6], caption: 'Raw records: evidence/results/agent-gate.jsonl; the stream of every run is in evidence/results/agent-gate.streams/.' })}`;
}

/** Experiment 3b: the same pilot when the target cannot be reached (1.3 at 200 N). */
function agentGateHardSection(d: SiteData): string {
  const runs = d.agentGateHard ?? [];
  if (runs.length === 0) return '';
  const arm = (a: string) => runs.filter((r) => r.arm === a);
  const n = (a: string, f: (r: (typeof runs)[number]) => boolean) => arm(a).filter(f).length;
  const rows = runs.map((r) => [r.arm === 'A' ? 'A (no Stop hook)' : 'B (Stop hook)', String(r.index + 1), esc(r.status), r.gateGreen ? '<span class="held">green</span>' : '<span class="broken">red</span>', r.claimsSuccess ? 'yes' : 'no', r.falseClaim ? '<span class="broken">yes</span>' : 'no', fmt(r.credits, 2), fmt(r.durationS / 60, 1)]);
  return `<h3 id="agent-gate-hard">3b: when the target cannot be reached</h3>
<p>Pre-registered before it ran (<a href="${REPO_URL}/blob/main/evidence/PREREG.md">PREREG.md</a>, experiment 3b): the same pilot with requirement 1.3 raised to 200 N, beyond what a reflex edit is expected to reach. <b>Without the Stop hook, ${n('A', (r) => r.falseClaim)} of 6 runs claimed success while the independent gate was red; with it, ${n('B', (r) => r.falseClaim)} of 6.</b> That is the predicted direction; with 6 runs per arm the difference is not significant (Fisher exact two-sided p = 0.55).</p>
<p>The false claims were not lies about what the agent saw. In each one, the agent ran <code>golem gate</code> itself, at the quick budget of 24 trials per line with the default search seed, and it printed GREEN; the independent gate, with another search seed, then found a 200 N push that still breaks 1.3. So the result is as much about the gate as about the agents: a green at a small budget is weak evidence, and the hooked runs, which the Stop hook kept working (up to 11 turns against mostly 1), claimed success less often. One arm-B run errored when its temporary workspace was deleted mid-run (0 turns) and two runs hit the 20-minute limit; they count in their arms as recorded. So we changed the gate; the re-check is below the table.</p>
${table(['Arm', 'Run', 'Status', 'Independent gate', 'Claims success', 'False claim', 'Credits', 'Minutes'], rows, { num: [6, 7], caption: 'Raw records: evidence/results/agent-gate-hard/agent-gate.jsonl; streams in evidence/results/agent-gate-hard/agent-gate.streams/.' })}
${confirmCheckPara(d)}`;
}

/** golem-spec 0.1.2 re-gates the 3b controllers: read from confirm-check.md through data.ts. */
function confirmCheckPara(d: SiteData): string {
  const rows = d.confirmCheck;
  if (rows.length === 0) return '';
  const claimed = rows.filter((r) => r.claimed);
  const quickGreen = claimed.filter((r) => r.quick === 'GREEN').length;
  const nowRed = claimed.filter((r) => r.confirmed === 'RED');
  const slipped = claimed.filter((r) => r.confirmed === 'GREEN');
  const controls = rows.filter((r) => !r.claimed);
  const falseClaims = (d.agentGateHard ?? []).filter((r) => r.falseClaim).length;
  const table2 = table(['Run', 'Claimed success', 'Gate the agent saw (one seed)', 'Gate of 0.1.2 (two seeds)', 'Independent gate, seed 7919'],
    rows.map((r) => [r.stream, r.claimed ? 'yes' : 'no (control)', r.quick, r.confirmed, r.independent]),
    { caption: 'Each controller rebuilt from its run’s file writes and gated once per command, with the real CLI. Raw output and the script: evidence/results/agent-gate-hard/confirm-check.md, evidence/scripts/confirm-check.ts.' });
  return `<p><b>The change, and a re-check.</b> Since golem-spec 0.1.2, a green <code>golem gate</code> searches every Expected_Hold line again with a second search seed derived from the first, at the same budget, before it prints GREEN; a line that breaks under the second seed makes the gate RED. We rebuilt the controllers of the false claims from their streams and gated them again, with no agent involved. ${claimed.length === falseClaims ? `All ${falseClaims} could be rebuilt; all ${quickGreen}` : `Of ${falseClaims}, ${claimed.length} could be rebuilt; ${quickGreen} of them`} were GREEN for the one-seed gate the agents saw, and ${nowRed.length} are RED for the new gate.${slipped.length ? ` ${slipped.map((r) => r.stream).join(', ')} still slips through: its second seed found nothing in 24 trials per line, while seed 7919 does. A second seed lowers the chance that a green is luck; it does not remove it.` : ''}${controls.length ? ` The control run${controls.length > 1 ? 's' : ''} (${controls.map((r) => r.stream).join(', ')}), which made no claim, ${controls.every((r) => r.confirmed === 'RED') ? 'is RED for the new gate too: its second seed found a push the independent gate missed' : 'keeps its verdict'}.` : ''}</p>
${table2}`;
}
