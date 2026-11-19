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
}

/** The numbers the home page quotes, drawn from the evidence files (never typed in). */
export function headlineNumbers(d: SiteData): Headline {
  const m = d.map.meta;
  return {
    weakDir: m.weakest.dirDeg, weakN: m.weakest.minHeldN, weakPhase: m.weakest.weakestPhase, strongDir: m.strongest.dirDeg, strongN: m.strongest.minHeldN,
    candyBroken: d.candy.broken, candyTrials: d.candy.trials, candyWorstM: d.candy.worstMinDistanceM,
    candyLink7: d.candy.closestLinkAtBreak['link7'] ?? 0, candyCup: d.candy.closestLinkAtBreak['cup'] ?? 0,
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
    { h: 'Shrink the failure', p: `GOLEM halves the push until it finds the mildest one that still breaks the sentence: ${fmt(wc.heldN)} N from ${sideName(weakDir.dirDeg)} (${d.map.meta.weakest.dirDeg}°).`, fig: shrinkFigure(wc.heldN, wc.brokeN, weakDir.dirDeg) },
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
  const right = `<figure class="ring-fig">${ringSvg(d.mapKiro.summary.summary, { id: 'ring-after', line: l13, lineN: LINE_N, after: true, label: 'After: the same policy with the reflex Kiro wrote' })}
<figcaption><b>After</b>With the reflex Kiro’s agent wrote. It holds ${LINE_N} N from ${after.holding} of ${after.dirs} directions. Weakest: ${fmt(after.weakest.minHeldN)} N from ${sideName(after.weakest.dirDeg)}.</figcaption></figure>`;
  return `<div class="rings wide">${left}${right}</div>
<div class="stats wide">
<div class="stat"><b class="${after.weakest.minHeldN > before.weakest.minHeldN ? 'hold' : 'break'}">${fmt(before.weakest.minHeldN)} → ${fmt(after.weakest.minHeldN)} N</b><span>The weakest push it survives, over ${before.dirs} directions, 5 stride phases and 3 seeds.</span></div>
<div class="stat"><b>${before.holding} → ${after.holding}</b><span>Directions out of ${before.dirs} that hold ${LINE_N} N, the force in requirement 1.3.</span></div>
<div class="stat"><b>${fmt(before.meanMin)} → ${fmt(after.meanMin)} N</b><span>Mean over directions of the weakest push survived.</span></div>
<div class="stat"><b class="${after.strongest.minHeldN >= before.strongest.minHeldN ? 'hold' : 'break'}">${fmt(before.strongest.minHeldN)} → ${fmt(after.strongest.minHeldN)} N</b><span>The strongest direction${after.strongest.minHeldN < before.strongest.minHeldN ? ' got a little weaker: the reflex trades some headroom from behind for the sides' : ''}.</span></div>
</div>`;
}

export function homePage(d: SiteData): PageSpec {
  const h = headlineNumbers(d);
  const g1 = d.lexicons.find((l) => l.app === 'stagger');
  const candy = d.lexicons.find((l) => l.app === 'candy');
  const expectedBreaks = d.falsifier.summary.length;
  const r12 = d.graded.summary.find((x) => x.reqId === '1.2');
  if (!r12) throw new Error('evidence/results/graded-margin/falsifier.summary.json has no row for 1.2');
  const gate = gateSummary(d);
  const budget = d.graded.meta.budget;
  const k = d.kiro.totals;
  const hero = d.hero;
  const heroLine = `WHEN the pelvis is pushed with up to ${hero.force} N for 0.2 s from any direction at any point in its stride, THE robot SHALL stay upright for 3 s`;
  const fell = hero.fellDeg.map((x) => `${x}°`).join(' and ');
  const caps = [
    { at: 0, k: 'A requirement for a Unitree G1 humanoid', h: 'This sentence is a robot’s requirement.', p: 'It is written in EARS, the format Kiro uses for acceptance criteria. GOLEM reads it as a test: a push, a duration, every direction, and a margin.' },
    { at: 0.16, k: 'golem-spec compiles it to physics', h: 'Each ghost is one physics trial.', p: `${hero.dirs} recorded shoves of ${hero.force} N, one every ${360 / hero.dirs}°, simulated in MuJoCo on Unitree’s published walking policy.` },
    { at: 0.45, k: 'A counterexample', h: `Pushed from its left, the G1 falls.`, p: `${hero.fellDeg.length} of ${hero.dirs} directions break the sentence (${fell}). GOLEM keeps the mildest failing push as a pinned seed that runs first next time.` },
    { at: 0.78, k: 'The verdict', h: 'Where the ring cracks, the sentence is false.', p: 'A Kiro Stop hook runs golem gate. While any sentence is cracked, Kiro’s agent cannot call the task done.' },
  ];
  const c0 = caps[0]!;
  const body = `
<section class="circle-scroll" data-circle-scroll aria-label="The Summoning Circle: a recorded test campaign of the G1, replayed as you scroll">
<div class="circle-stage" data-circle data-line="${esc(heroLine)}" data-caps="${esc(JSON.stringify(caps))}">
<div class="circle-fallback" style="background-image:url(/hero/poster.jpg)" role="img" aria-label="A clay Unitree G1 in a ring of text, with ghost copies of it pushed outward; two fall, and the letters crack red on that side."></div>
<div class="circle-cap" data-circle-cap aria-live="polite"><span class="k">${esc(c0.k)}</span><h1>${esc(c0.h)}</h1><p>${esc(c0.p)}</p></div>
<div class="circle-dots" aria-hidden="true">${caps.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
<div class="circle-hint" aria-hidden="true">Scroll to run the test</div>
</div>
</section>

<p class="oneline"><em>GOLEM</em> is an npm package that turns the sentences in a Kiro spec into physics tests, and stops Kiro’s agent from saying “done” until every sentence holds.</p>
<p class="lede">The robot in the circle is a simulated Unitree G1. The ring is the sentence above, written on the floor. The ghosts are real recorded trials. Where pushes from one side knock the robot over, the letters on that side crack.</p>
<ol class="try-steps" aria-label="Three ways in">
<li><b>Install it:</b> <code>npm i -D golem-spec</code>, then <code>npx golem-spec init</code> adds the hooks, agents and MCP server to <code>.kiro/</code>.</li>
<li><b>Shove the robot yourself:</b> the <a href="#studio">live studio</a> below runs the same physics in your browser.</li>
<li><b>Check the numbers:</b> every figure on this site is drawn from a file in <a href="${REPO_URL}">the repository</a>.</li>
</ol>

<section class="npm-card" aria-labelledby="npm-h">
<a class="npm-badge" href="https://www.npmjs.com/package/golem-spec">npm · golem-spec</a>
<h2 id="npm-h">One package runs everything on this site</h2>
<p>Both robots here run on <a href="https://www.npmjs.com/package/golem-spec"><code>golem-spec</code></a>, the package any Kiro project can install. It ships the EARS compiler, the MuJoCo test runner, the counterexample search, the <code>golem</code> CLI, an MCP server with eight tools, and a Kiro pack of hooks, agents, skills and steering.</p>
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
<p>GOLEM ties them together. On the G1 controller in this repository, <code>golem gate</code> exits with code ${gate.exit} and names ${gate.broken} of the ${gate.total} lines as not held. Kiro’s claim of “done” has to survive that.</p>

<section class="bleed" aria-labelledby="how"><div class="bleed-in">
<h2 id="how">How it works</h2>
<ol class="pipeline">${pipeline(d)}</ol>
<p class="alt">All six figures use files committed in this repository: the G1 requirements, the stability map, a pinned seed and the output of <code>golem gate</code>.</p>
</div></section>

<h2 id="robots">Two robots, one package</h2>
<div class="cards wide">
<article class="card"><h3>Stagger: a Unitree G1</h3><p>A humanoid walking under Unitree’s published policy. ${g1?.lines.length ?? 0} requirement lines cover pushes, speed tracking, slopes, payload, slipping and sensor latency. ${expectedBreaks} of them are written to break, so the gate has something to catch.</p><p><a class="btn" href="/stagger/">Open the G1 studio</a></p></article>
<article class="card"><h3>Candy: a Franka Panda</h3><p>A suction cup sorts Halloween candy into bowls while a trick-or-treater’s hand reaches into the workspace. ${candy?.lines.length ?? 0} lines cover task success and keeping the arm clear of hands.</p><p><a class="btn" href="/candy/">Open the candy studio</a></p></article>
</div>

<h2 id="results">Measured results</h2>
<p>Measurements, with their budgets. The <a href="/evidence/">evidence page</a> has the methods and the raw files.</p>
<div class="stats wide">
<div class="stat"><b class="break">${fmt(h.weakN)} N</b><span>The G1’s weakest direction on Unitree’s policy: ${h.weakDir}°, a push from ${sideName(h.weakDir)}, at stride phase ${h.weakPhase}.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b class="hold">${fmt(h.strongN)} N</b><span>Its strongest: ${h.strongDir}°, from ${sideName(h.strongDir)}. A factor of ${fmt(h.strongN / h.weakN)} between the two.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b>${h.candyBroken} of ${h.candyTrials}</b><span>Candy trials that break “keep every link 0.10 m from the hand”. The closest link is the wrist in ${h.candyLink7}, the cup in ${h.candyCup}.</span><a href="/evidence/#candy">The candy measurement</a></div>
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
<li><b>The hero is a recording.</b> The circle replays ${hero.dirs} trials recorded at ${hero.force} N with one seed each; the stability map uses three seeds and five stride phases, so its numbers are stricter.</li>
</ul>

<h2 id="start">Break the golem, then fix it</h2>
<p class="lede">Shove the G1, read the sentence that broke, then hand that failure to an agent.</p>
<div class="btn-row"><a class="btn primary" href="/stagger/">Shove the G1</a><a class="btn" href="https://www.npmjs.com/package/golem-spec">Install golem-spec</a><a class="btn" href="/evidence/">Read the evidence</a><a class="btn" href="${REPO_URL}" rel="noopener">View the source</a></div>
<p class="small muted">The requirement the first figure shows reads: ${earsHtml(g1?.lines.find((l) => l.id === '1.2')?.source ?? '')}</p>
`;
  return {
    id: 'home', path: '/',
    title: 'GOLEM: EARS requirements that run as physics tests',
    description: 'GOLEM (npm: golem-spec) turns the EARS acceptance criteria of a Kiro spec into MuJoCo physics tests, searches for the push that breaks each one, and gates Kiro’s agent until every requirement holds.',
    body, modules: ['/src/client/home.ts', '/src/studio/load.ts'],
    mainClass: 'home-main',
    head: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"GOLEM","alternateName":"golem-spec","applicationCategory":"DeveloperApplication","operatingSystem":"Web browser, Node.js 20+","description":"An npm package (golem-spec) that compiles the EARS acceptance criteria of a Kiro spec into MuJoCo physics property tests, searches for the scenario that breaks each requirement, shrinks it to the mildest failure, and gates Kiro's AI agent with a Stop hook until every requirement holds. Demonstrated on a Unitree G1 humanoid and a Franka Panda arm.","license":"https://www.apache.org/licenses/LICENSE-2.0","codeRepository":"${REPO_URL}","downloadUrl":"https://www.npmjs.com/package/golem-spec","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script>\n<link rel="preload" as="fetch" href="/hero/pack.json" crossorigin>\n<link rel="preload" as="fetch" href="/hero/pack.bin" crossorigin>`,
  };
}
