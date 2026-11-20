import { readFileSync } from 'node:fs';
// Home: the Summoning Circle (a recorded G1 campaign replayed as you scroll), then the argument in plain order:
// what it is, the npm package, Kiro making the robot stronger, the live studio, how it works, the evidence, the limits.
import type { SiteData } from '../build/data';
import { codeBlock, earsHtml, esc, fmt } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { parseTranscript } from '../build/transcript';
import { earsFigure, gateFigure, ghostFigure, seedFigure, shrinkFigure, spaceFigure } from '../figures/pipeline';
import { groupByDirection, weakestCell } from '../figures/polar';
import { ringStats, ringSvg, sideName } from '../figures/rings';

export interface Headline {
  weakDir: number; weakN: number; weakPhase: number; strongDir: number; strongN: number;
  candyBroken: number; candyTrials: number; candyWorstM: number; candyLink7: number; candyCup: number;
  hover: HoverHeadline;
}

/** The hover numbers, read from site/data/hover.json (which gen-hover.mjs wrote from the committed CLI output). */
export interface HoverHeadline {
  lines: number; expectedBreaks: number; budget: number; runs: number;
  /** Line 1.3: the gust it asks to survive (N), the ball it must stay in (m), and the smallest gust that broke it (N). */
  askN: number; ballM: number; breakN: number;
  /** Line 1.1: the gust (N), the ball (m) and the smallest margin over the runs (m). */
  smallN: number; smallBallM: number; smallMarginM: number;
  /** Line 3.2: the lag it asks to survive (s) and the smallest lag that broke it (s). */
  lagAskS: number; lagBreakS: number;
}

const need = (v: RegExpExecArray | null, what: string): number => {
  if (!v) throw new Error('site/data/hover.json: cannot read ' + what);
  return Number(v[1]);
};
const sig = (n: number): number => Number(n.toPrecision(3));

export function hoverNumbers(d: SiteData): HoverHeadline {
  const line = (id: string) => {
    const l = d.hover.lines.find((x) => x.id === id);
    if (!l) throw new Error('site/data/hover.json has no line ' + id + '. Run: node site/scripts/gen-hover.mjs');
    return l;
  };
  const l11 = line('1.1'), l13 = line('1.3'), l32 = line('3.2');
  return {
    lines: d.hover.lines.length, expectedBreaks: d.hover.lines.filter((l) => l.expectation === 'Expected_Break').length,
    budget: d.hover.budget, runs: d.hover.runs.length,
    askN: need(/up to ([\d.]+) N/.exec(l13.source), 'the gust of line 1.3'), ballM: need(/within ([\d.]+) m/.exec(l13.source), 'the ball of line 1.3'),
    breakN: sig(Math.min(...l13.counterexamples.map((c) => need(/gust\.force = ([\d.]+) N/.exec(c), 'a gust of line 1.3')))),
    smallN: need(/up to ([\d.]+) N/.exec(l11.source), 'the gust of line 1.1'), smallBallM: need(/within ([\d.]+) m/.exec(l11.source), 'the ball of line 1.1'),
    smallMarginM: l11.marginMin,
    lagAskS: need(/lags by up to ([\d.]+) s/.exec(l32.source), 'the lag of line 3.2'),
    lagBreakS: sig(Math.min(...l32.counterexamples.map((c) => need(/estimate\.lag = ([\d.]+) s/.exec(c), 'a lag of line 3.2')))),
  };
}

/** The numbers the home page quotes, drawn from the evidence files (never typed in). */
export function headlineNumbers(d: SiteData): Headline {
  const m = d.map.meta;
  return {
    weakDir: m.weakest.dirDeg, weakN: m.weakest.minHeldN, weakPhase: m.weakest.weakestPhase, strongDir: m.strongest.dirDeg, strongN: m.strongest.minHeldN,
    candyBroken: d.candy.broken, candyTrials: d.candy.trials, candyWorstM: d.candy.worstMinDistanceM,
    candyLink7: d.candy.closestLinkAtBreak['link7'] ?? 0, candyCup: d.candy.closestLinkAtBreak['cup'] ?? 0,
    hover: hoverNumbers(d),
  };
}

function pipeline(d: SiteData): string {
  const g1 = d.lexicons.find((l) => l.app === 'stagger');
  const line12 = g1?.lines.find((l) => l.id === '1.2');
  if (!line12) throw new Error('site/data/lexicon.json has no line 1.2 for stagger. Run: npm run gen -w site');
  const dirs = groupByDirection(d.mapCells);
  const weakDir = dirs.find((x) => x.dirDeg === d.map.meta.weakest.dirDeg)!;
  const wc = weakestCell(weakDir)!;
  const gate = parseTranscript(d.transcriptMd).find((s) => s.command === 'golem gate');
  const gateLine = gate?.code.split('\n').find((l) => l.startsWith('gate RED'));
  if (!gate || !gateLine) throw new Error('docs/cli-transcript.md has no "golem gate" section with a "gate RED" line');
  const gl = gate.code.split('\n');
  const i13 = gl.findIndex((l) => l.startsWith('1.3:'));
  const block = [`${(gl[i13] as string).slice(0, 40)}…`, (gl[i13 + 2] as string).trim(), (gl[i13 + 3] as string).trim()];
  const seed = d.pinnedSeed[0];
  if (!seed) throw new Error('apps/stagger/.golem/seeds/stagger/1.3.json is empty');
  const steps: { h: string; p: string; fig: string }[] = [
    { h: 'Write a sentence', p: 'The acceptance criterion is an EARS sentence in the Kiro spec, with a unit on every number.', fig: earsFigure(line12.source) },
    { h: 'Compile it', p: 'The ranges in the WHEN part become the space to search. The SHALL part becomes a margin in metres or newtons.', fig: spaceFigure(line12) },
    { h: 'Summon ghosts', p: `Each trial is a ghost: one MuJoCo run of the robot. ${d.map.meta.dirs} directions of pushes trace where it holds and where it breaks.`, fig: ghostFigure(d.mapCells) },
    { h: 'Shrink the failure', p: `GOLEM halves the push until it brackets the boundary: from ${sideName(weakDir.dirDeg)} (${d.map.meta.weakest.dirDeg}°) the G1 survives ${fmt(wc.heldN)} N and falls at ${fmt(wc.brokeN)} N.`, fig: shrinkFigure(wc.heldN, wc.brokeN, weakDir.dirDeg) },
    { h: 'Pin the seed', p: 'The failing scenario and its random seed are saved to a file. Saved seeds run first, every time.', fig: seedFigure(seed, '.golem/seeds/stagger/1.3.json') },
    { h: 'Gate the agent', p: 'A Kiro Stop hook runs golem gate. While any sentence is false, the agent cannot end its turn as done.', fig: gateFigure(gateLine, block) },
  ];
  return steps.map((s, i) => `<li><span class="step-n">Step ${i + 1} of 6</span><h3>${s.h}</h3><figure>${s.fig}</figure><p>${s.p}</p></li>`).join('');
}

/** The numbers of the `golem gate` run in docs/cli-transcript.md. */
export function gateSummary(d: SiteData): { exit: number; seconds: number; broken: number; total: number } {
  const s = parseTranscript(d.transcriptMd).find((x) => x.command === 'golem gate');
  const t = s ? /\(exit (\d+), (\d+) s\)/.exec(s.title) : null;
  const g = s ? /gate RED: (\d+) of (\d+)/.exec(s.code) : null;
  if (!t || !g) throw new Error('docs/cli-transcript.md: the golem gate section lacks its exit code, its seconds or its "gate RED: n of m" line');
  return { exit: Number(t[1]), seconds: Number(t[2]), broken: Number(g[1]), total: Number(g[2]) };
}

const LINE_N = 100; // requirement 1.3: up to 100 N from any direction

function ringsSection(d: SiteData): string {
  const g1 = d.lexicons.find((l) => l.app === 'stagger');
  const l13 = g1?.lines.find((l) => l.id === '1.3')?.source ?? '';
  const before = ringStats(d.map.summary, LINE_N);
  const left = `<figure class="ring-fig">${ringSvg(d.map.summary, { id: 'ring-before', line: l13, lineN: LINE_N, label: 'Before: Unitree’s walking policy alone' })}
<figcaption><b>Before</b>Unitree’s published policy. It holds ${LINE_N} N from ${before.holding} of ${before.dirs} directions. Weakest: ${fmt(before.weakest.minHeldN)} N from ${sideName(before.weakest.dirDeg)}.</figcaption></figure>`;
  if (!d.mapKiro) {
    return `<div class="rings wide">${left}<figure class="ring-fig"><figcaption><b>After</b>The same map with Kiro’s reflex is still running. This half appears when its file is committed.</figcaption></figure></div>`;
  }
  const after = ringStats(d.mapKiro.summary.summary, LINE_N);
  const byDir = new Map(d.mapKiro.summary.summary.map((x) => [x.dirDeg, x.minHeldN]));
  const loss = d.map.summary.map((x) => ({ dir: x.dirDeg, d: (byDir.get(x.dirDeg) ?? x.minHeldN) - x.minHeldN })).sort((p, q) => p.d - q.d)[0]!;
  const right = `<figure class="ring-fig">${ringSvg(d.mapKiro.summary.summary, { id: 'ring-after', line: l13, lineN: LINE_N, after: true, label: 'After: the same policy with the reflex Kiro wrote' })}
<figcaption><b>After</b>With the reflex Kiro’s agent wrote. It holds ${LINE_N} N from ${after.holding} of ${after.dirs} directions. Weakest: ${fmt(after.weakest.minHeldN)} N from ${sideName(after.weakest.dirDeg)}.</figcaption></figure>`;
  return `<div class="rings wide">${left}${right}</div>
<div class="stats wide">
<div class="stat"><b class="${after.weakest.minHeldN > before.weakest.minHeldN ? 'hold' : 'break'}">${fmt(before.weakest.minHeldN)} → ${fmt(after.weakest.minHeldN)} N</b><span>The weakest push it survives, over ${before.dirs} directions, 5 stride phases and 3 seeds.</span></div>
<div class="stat"><b>${before.holding} → ${after.holding}</b><span>Directions out of ${before.dirs} that hold ${LINE_N} N, the force in requirement 1.3.</span></div>
<div class="stat"><b>${fmt(before.meanMin)} → ${fmt(after.meanMin)} N</b><span>Mean over directions of the weakest push survived.</span></div>
<div class="stat"><b class="break">${fmt(loss.d)} N at ${loss.dir}°</b><span>The largest loss in any one direction, a push from ${sideName(loss.dir)}. The reflex trades a little headroom there for the sides.</span></div>
</div>`;
}

export function homePage(d: SiteData): PageSpec {
  const h = headlineNumbers(d);
  const g1 = d.lexicons.find((l) => l.app === 'stagger');
  const candy = d.lexicons.find((l) => l.app === 'candy');
  // lines the G1 spec marks Expected_Break in its Expectation table
  const specText = readFileSync(new URL('../../../apps/stagger/.kiro/specs/g1-walking/requirements.md', import.meta.url), 'utf8');
  const expectedBreaks = specText.split('\n').filter((l) => /^\|\s*\d+\.\d+\s*\|.*\|\s*Expected_Break\s*\|\s*$/.test(l.trim())).length;
  const r12 = d.graded.summary.find((x) => x.reqId === '1.2');
  if (!r12) throw new Error('evidence/results/graded-margin/falsifier.summary.json has no row for 1.2');
  const gate = gateSummary(d);
  const budget = d.graded.meta.budget;
  const k = d.kiro.totals;
  const hero = d.hero;
  // The hero inscribes requirement 1.3 exactly, and replays each map direction's hardest recorded cell at its force.
  const heroLine = (g1?.lines.find((l) => l.id === '1.3')?.source ?? '').replace(' THE robot', ', THE robot');
  const fell = hero.fellDeg.map((x) => `${x}°`).join(' and ');
  const kiroHeld = hero.kiroFellDeg !== undefined && hero.kiroFellDeg.length === 0;
  const caps = [
    { at: 0, k: 'Requirement 1.3 for a Unitree G1 humanoid', h: 'This sentence is a robot’s requirement.', p: `Kiro writes acceptance criteria like this in EARS. GOLEM reads it as a test: ${hero.force} N for 0.2 s, from every direction, at any point in the stride.` },
    { at: 0.16, k: 'golem-spec compiles it to physics', h: `${hero.dirs} ghosts, one per direction.`, p: `Each ghost is one MuJoCo trial of Unitree’s published walking policy, shoved with ${hero.force} N from its own side at that side’s weakest recorded moment.` },
    { at: 0.45, k: 'A counterexample', h: 'Pushed from its left, the G1 falls.', p: `${hero.fellDeg.length} of ${hero.dirs} directions break the sentence (${fell}). GOLEM keeps the mildest failing push as a pinned seed that runs first next time.` },
    { at: 0.78, k: 'The verdict', h: 'Where the ring cracks, the sentence is false.', p: `A Kiro Stop hook runs golem gate and blocks the agent while a line is cracked.${kiroHeld ? ' Now switch on the reflex Kiro wrote.' : ''}` },
  ];
  const capsKiro = [
    { at: 0, k: 'Requirement 1.3, with Kiro’s reflex', h: 'The same sentence, the same 36 shoves.', p: 'Same scenarios and seeds. The one change: the balance reflex Kiro’s golem-tuner agent wrote under the gate.' },
    { at: 0.16, k: 'Unitree’s policy + Kiro’s reflex', h: `${hero.dirs} ghosts again.`, p: 'The reflex adds a sideways step when the pelvis suddenly moves sideways, so the robot walks with a push instead of braking against it.' },
    { at: 0.45, k: kiroHeld ? 'No counterexample' : 'A counterexample', h: kiroHeld ? 'Pushed from its left, it steps and stays up.' : 'It still falls.', p: kiroHeld ? `All ${hero.dirs} directions hold, including ${fell}.` : `${hero.kiroFellDeg?.length ?? 0} directions still break.` },
    { at: 0.78, k: 'The verdict', h: kiroHeld ? 'The ring is whole: 1.3 holds.' : 'The ring is still cracked.', p: 'Re-measured over 4,860 trials, the weakest push it survives rose from 62.5 N to 101.6 N.' },
  ];
  const c0 = caps[0]!;
  const body = `
<h1 class="sr-only">GOLEM: robot requirements that run as physics tests</h1>
<section class="circle-scroll" data-circle-scroll aria-label="The Summoning Circle: a recorded test campaign of the G1, replayed as you scroll">
<div class="circle-stage" data-circle data-line="${esc(heroLine)}" data-caps="${esc(JSON.stringify(caps))}" data-caps-kiro="${esc(JSON.stringify(capsKiro))}">
<div class="circle-fallback" style="background-image:url(/hero/poster.jpg)" role="img" aria-label="A clay Unitree G1 in a ring of text, with ghost copies of it pushed outward; the ones pushed from its left fall, and the floor cracks through the letters."></div>
<div class="circle-cap" data-circle-cap aria-live="polite"><span class="k">${esc(c0.k)}</span><p class="cap-h">${esc(c0.h)}</p><p class="cap-p">${esc(c0.p)}</p></div>
<div class="circle-dots" aria-hidden="true">${caps.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
<div class="circle-hint" aria-hidden="true">Scroll to run the test</div>
${hero.kiroFellDeg !== undefined ? `<div class="circle-toggle" role="group" aria-label="Controller"><button type="button" data-pack="pack" aria-pressed="true">Unitree’s policy</button><button type="button" data-pack="pack-kiro" aria-pressed="false">+ Kiro’s reflex</button></div>` : ''}
</div>
</section>

<p class="oneline"><em>GOLEM</em> is an npm package that turns the sentences in a Kiro spec into physics tests, and blocks Kiro’s agent when it tries to finish with any sentence still false.</p>
<p class="lede">The robot in the circle is a simulated Unitree G1. The ring is requirement 1.3, written on the floor. The ghosts are real recorded trials, the hardest one the stability map found in each direction. Where a ghost falls, the floor cracks through the sentence. The switch replays the same shoves with the reflex Kiro wrote.</p>
<ol class="try-steps" aria-label="Three ways in">
<li><b>Install it:</b> <code>npm i -D golem-spec</code>, then <code>npx golem-spec init</code> adds the hooks, agents and MCP server to <code>.kiro/</code>.</li>
<li><b>Shove the robot yourself:</b> the <a href="#studio">live studio</a> below runs the same physics in your browser.</li>
<li><b>Check the numbers:</b> every figure on this site is drawn from a file in <a href="${REPO_URL}">the repository</a>.</li>
</ol>

<section class="npm-card" aria-labelledby="npm-h">
<a class="npm-badge" href="https://www.npmjs.com/package/golem-spec">npm · golem-spec</a>
<h2 id="npm-h">One package runs everything on this site</h2>
<p>All three robots here run on <a href="https://www.npmjs.com/package/golem-spec"><code>golem-spec</code></a>, the package any Kiro project can install. It ships the EARS compiler, the MuJoCo test runner, the counterexample search, the <code>golem</code> CLI, an MCP server with eight tools, and a Kiro pack of hooks, agents, skills and steering.</p>
${codeBlock(`npm i -D golem-spec      # the package
npx golem-spec init      # hooks, agents, MCP server and skills into .kiro/
npx golem-spec test      # try to break every EARS line in .kiro/specs
npx golem-spec gate      # exit 0 only if every line holds`, 'the install commands')}
<p class="small muted"><a href="https://www.npmjs.com/package/golem-spec">golem-spec on npm</a> · <a href="${REPO_URL}">source on GitHub</a> · <a href="/kit/">the kit page</a> · Apache-2.0</p>
</section>

<h2 id="stronger">Kiro made the robot stronger, and GOLEM measured it</h2>
<p class="lede">Requirement 1.3 says the G1 must survive a 100 N push from any direction. On Unitree’s policy alone it does not. GOLEM handed the counterexample to <code>golem-tuner</code>, a Kiro agent, which wrote a balance reflex under the Stop gate until the line held.</p>
${ringsSection(d)}
<p>The rings are the same stability map run twice: 36 directions, 5 stride phases, 3 seeds, a bisection on force in each cell. The reflex steps into a sideways push instead of braking against it. It ships as a switch, <code>GOLEM_REFLEX=kiro</code>; the default stays Unitree’s policy exactly. The agent’s full session log is in <a href="${REPO_URL}/tree/main/evidence/results/tuner"><code>evidence/results/tuner/</code></a>.</p>

<h2 id="studio-h">Shove it yourself</h2>
<p>This is the real thing, not a recording: MuJoCo compiled to WebAssembly, Unitree’s policy, and the GOLEM falsifier running in your browser’s worker threads. Drag the robot to push it, or summon 64 ghosts on a requirement and watch the verdict form.</p>
<div class="flush hero-studio" id="studio" data-studio="stagger" data-when="idle" data-status="Waking the golem…"><button class="poster" type="button" data-wake aria-label="Wake the G1 studio. This loads the physics simulation."><span class="poster-cta">Wake the golem</span></button><noscript><p class="hero-fallback">The live studio needs JavaScript. The measured results below do not.</p></noscript></div>

<h2 id="problem">Agents ship demos, not evidence</h2>
<p class="lede">An AI coding agent can write a walking controller in an afternoon. What it hands back is a video of the robot walking.</p>
<p>The spec says the robot must stay upright after a push of up to 250 N. The video shows one push. Nothing ties the claim to the sentence, and nothing says what happens at ${fmt(h.weakN)} N from the wrong side.</p>
<p>GOLEM ties them together. On the G1 controller in this repository, <code>golem gate</code> exits with code ${gate.exit} and names ${gate.broken} of the ${gate.total} lines as not meeting their expectation (a line marked Expected_Break passes when it breaks). Kiro’s claim of “done” has to survive that.</p>

<section class="bleed" aria-labelledby="how"><div class="bleed-in">
<h2 id="how">How it works</h2>
<ol class="pipeline">${pipeline(d)}</ol>
<p class="alt">All six figures use files committed in this repository: the G1 requirements, the stability map, a pinned seed and the output of <code>golem gate</code>.</p>
</div></section>

<h2 id="robots">Three robots, one package</h2>
<div class="cards wide">
<article class="card"><h3>Stagger: a Unitree G1</h3><p>A humanoid walking under Unitree’s published policy. ${g1?.lines.length ?? 0} requirement lines cover pushes, speed tracking, slopes, payload, slipping and sensor latency. ${expectedBreaks} of them are marked Expected_Break: the spec says they must break, and the gate checks that they do.</p><p><a class="btn" href="/stagger/">Open the G1 studio</a></p></article>
<article class="card"><h3>Candy: a Franka Panda</h3><p>A suction cup sorts Halloween candy into bowls while a trick-or-treater’s hand reaches into the workspace. ${candy?.lines.length ?? 0} lines cover task success and keeping the arm clear of hands.</p><p><a class="btn" href="/candy/">Open the candy studio</a></p></article>
<article class="card"><h3>Hover: a Skydio X2</h3><p>A quadrotor holds a point in the wind. ${h.hover.lines} lines cover gusts, a sagging battery and a late position estimate; ${h.hover.expectedBreaks} are marked Expected_Break. Line 1.3 asks it to stay within ${fmt(h.hover.ballM)} m in a gust of up to ${fmt(h.hover.askN)} N, and it breaks from ${fmt(h.hover.breakN, 2)} N. The same skeleton, a lexicon and a controller, and nothing else.</p><p><a class="btn" href="/hover/">Open the hover studio</a></p></article>
</div>

<h2 id="results">Measured results</h2>
<p>Measurements, with their budgets. The <a href="/evidence/">evidence page</a> has the methods and the raw files.</p>
<div class="stats wide">
<div class="stat"><b class="break">${fmt(h.weakN)} N</b><span>The G1’s weakest direction on Unitree’s policy: ${h.weakDir}°, a push from ${sideName(h.weakDir)}, at stride phase ${h.weakPhase}.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b class="hold">${fmt(h.strongN)} N</b><span>Its strongest: ${h.strongDir}°, from ${sideName(h.strongDir)}. A factor of ${fmt(h.strongN / h.weakN)} between the two.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b>${h.candyBroken} of ${h.candyTrials}</b><span>Candy trials that break “keep every link 0.10 m from the hand”. The closest link is the wrist in ${h.candyLink7}, the cup in ${h.candyCup}.</span><a href="/evidence/#candy">The candy measurement</a></div>
<div class="stat"><b>${fmt(h.hover.breakN, 2)} N</b><span>The gust that carries the Skydio X2 out of a ${fmt(h.hover.ballM)} m ball around its hover point. Line 1.3 asks for ${fmt(h.hover.askN)} N and breaks. A ${fmt(h.hover.smallN)} N gust holds within ${fmt(h.hover.smallBallM, 2)} m with at least ${fmt(h.hover.smallMarginM, 4)} m to spare. A position estimate that lags by ${fmt(h.hover.lagBreakS, 3)} s breaks line 3.2 (it asks for ${fmt(h.hover.lagAskS, 2)} s). Search budget ${h.hover.budget} trials, ${h.hover.runs} search seeds.</span><a href="https://github.com/RohanGlitched/golem/blob/main/apps/hover/docs/cli-transcript.md">The CLI transcript</a></div>
<div class="stat"><b>${r12.guided.found}/${r12.guided.n} vs ${r12.random.found}/${r12.random.n}</b><span>Line 1.2 found by guided search and by random sampling at budget ${budget}. On the G1 lines, guided search is no better than random.</span><a href="/evidence/#benchmark">The benchmark</a></div>
</div>

<h2 id="kiro">Built in Kiro, spec by spec</h2>
<p>GOLEM was built in Kiro through specs, hooks, steering and agents, and the robots’ own requirements are Kiro specs. The counts below are generated from the <code>.kiro/</code> folders by <code>scripts/kiro-stats.mjs</code>.</p>
<div class="stats wide">
<div class="stat"><b>${k['specs']}</b><span>Kiro specs, ${k['bugfixSpecs']} of them bugfix specs written after audits found real bugs.</span></div>
<div class="stat"><b>${(k['earsCriteria'] ?? 0).toLocaleString('en-US')}</b><span>EARS acceptance criteria across ${k['requirements']} requirements.</span></div>
<div class="stat"><b>${d.kiro.tests.propertyAsserts}</b><span>fast-check property assertions in ${d.kiro.tests.files} test files.</span></div>
<div class="stat"><b>${k['hooks']} · ${k['agents']} · ${k['steering']}</b><span>Hooks, custom agents and steering files.</span></div>
</div>
<p><a class="btn" href="/how-kiro/">How Kiro built it</a></p>

<h2 id="limits">Limits, stated plainly</h2>
<ul>
<li><b>“Held” means no counterexample was found within the budget.</b> It is not a proof. Every report states its budget, for example ${budget} trials per line.</li>
<li><b>This is simulation.</b> MuJoCo models a G1 and a Panda. No real robot ran any of these tests.</li>
<li><b>One policy.</b> The G1 results are for Unitree’s published walking policy, with and without Kiro’s reflex.</li>
<li><b>Guided search did not beat random sampling</b> on the G1 lines at budget ${budget}. It does on a synthetic narrow region. <a href="/evidence/#benchmark">Both results are on the evidence page.</a></li>
<li><b>The Stop gate's effect on false “done” claims is a pilot.</b> With a reachable target no agent claimed success falsely in either arm (0/6 and 0/6). With an unreachable one, 3 of 6 runs without the hook and 1 of 6 with it claimed success while an independent gate was red (p = 0.55): agents trusted a quick 24-trial green that another search seed broke.${(() => { const c = d.confirmCheck.filter((r) => r.claimed); return c.length ? ` Since 0.1.2 the gate confirms a green with a second search seed; re-gated, ${c.filter((r) => r.confirmed === 'RED').length} of those ${c.length} controllers come out red, and ${c.filter((r) => r.confirmed === 'GREEN').length} still passes.` : ''; })()} <a href="/evidence/#agent-gate-hard">Both pilots and the re-check</a>.</li>
<li><b>The hero is a recording.</b> No physics runs in the circle: it replays ${hero.dirs} trials recorded at ${hero.force} N, one per direction, each at the stride phase and seed of that direction’s weakest cell in the stability map. The live studio runs real physics.</li>
</ul>

<h2 id="start">Break the golem, then fix it</h2>
<p class="lede">Shove the G1, read the sentence that broke, then hand that failure to an agent.</p>
<div class="btn-row"><a class="btn primary" href="/stagger/">Shove the G1</a><a class="btn" href="https://www.npmjs.com/package/golem-spec">Install golem-spec</a><a class="btn" href="/evidence/">Read the evidence</a><a class="btn" href="${REPO_URL}" rel="noopener">View the source</a></div>
<p class="small muted">The requirement in the circle, line 1.3 of <code>apps/stagger/.kiro/specs/g1-walking/requirements.md</code>: ${earsHtml(g1?.lines.find((l) => l.id === '1.3')?.source ?? '')}</p>
`;
  return {
    id: 'home', path: '/',
    title: 'GOLEM: EARS requirements that run as physics tests',
    description: 'GOLEM (npm: golem-spec) turns the EARS acceptance criteria of a Kiro spec into MuJoCo physics tests, searches for the push that breaks each one, and gates Kiro’s agent until every requirement holds.',
    body, modules: ['/src/client/home.ts', '/src/studio/load.ts'],
    mainClass: 'home-main',
    head: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"GOLEM","alternateName":"golem-spec","applicationCategory":"DeveloperApplication","operatingSystem":"Web browser, Node.js 20+","description":"An npm package (golem-spec) that compiles the EARS acceptance criteria of a Kiro spec into MuJoCo physics property tests, searches for the scenario that breaks each requirement, shrinks it to the mildest failure, and gates Kiro's AI agent with a Stop hook until every requirement holds. Demonstrated on a Unitree G1 humanoid, a Franka Panda arm and a Skydio X2 quadrotor, and in a yard of eight MuJoCo Menagerie robots.","license":"https://www.apache.org/licenses/LICENSE-2.0","codeRepository":"${REPO_URL}","downloadUrl":"https://www.npmjs.com/package/golem-spec","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script>\n<link rel="preload" as="fetch" href="/hero/pack.json" crossorigin>\n<link rel="preload" as="fetch" href="/hero/pack.bin" crossorigin>`,
  };
}
