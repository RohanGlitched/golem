// Home: the live G1 studio first, then the argument in lab-notebook order.
import type { SiteData } from '../build/data';
import { codeBlock, earsHtml, fmt } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { parseTranscript } from '../build/transcript';
import { earsFigure, gateFigure, ghostFigure, seedFigure, shrinkFigure, spaceFigure } from '../figures/pipeline';
import { groupByDirection, weakestCell } from '../figures/polar';

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
    { h: 'An EARS line', p: 'The acceptance criterion is a sentence in the spec, with a unit on every number.', fig: earsFigure(line12.source) },
    { h: 'A scenario space and a monitor', p: 'The compiler reads the ranges in the trigger as what to search, and the response as a margin in physical units.', fig: spaceFigure(line12) },
    { h: 'Ghosts', p: `Every trial is a ghost. The measured boundary in ${d.map.meta.dirs} directions is the line between those that held and those that broke.`, fig: ghostFigure(d.mapCells) },
    { h: 'Shrink', p: `Halving the force on the weakest cell (${d.map.meta.weakest.dirDeg}°) closes in on ${fmt(wc.heldN)} N, the mildest push that still breaks it.`, fig: shrinkFigure(wc.heldN, wc.brokeN, weakDir.dirDeg) },
    { h: 'A pinned seed', p: 'Each counterexample is saved with its scenario and seed. Pinned seeds run first, every time.', fig: seedFigure(seed, '.golem/seeds/stagger/1.3.json') },
    { h: 'The Stop gate', p: 'A Kiro Stop hook runs golem gate. While any requirement is red, the agent cannot call the task done.', fig: gateFigure(gateLine, block) },
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

export function homePage(d: SiteData): PageSpec {
  const h = headlineNumbers(d);
  const g1 = d.lexicons.find((l) => l.app === 'stagger');
  const candy = d.lexicons.find((l) => l.app === 'candy');
  const expectedBreaks = d.falsifier.summary.length;
  const r12 = d.graded.summary.find((x) => x.reqId === '1.2');
  if (!r12) throw new Error('evidence/results/graded-margin/falsifier.summary.json has no row for 1.2');
  const gate = gateSummary(d);
  const budget = d.graded.meta.budget;
  const body = `
<h1 class="hero-line flush">Shove the robot. Then summon the ghosts.</h1>
<div class="flush hero-studio" id="studio" data-studio="stagger" data-when="idle" data-status="Waking the golem…"><button class="poster" type="button" data-wake aria-label="Wake the G1 studio. This loads the physics simulation."><span class="poster-cta">Wake the golem</span></button><noscript><p class="hero-fallback">The live studio needs JavaScript. The measured results below do not.</p></noscript></div>

<h2 id="problem">Agents ship demos, not evidence</h2>
<p class="lede">An AI coding agent can write a walking controller in an afternoon. What it hands back is a video of the robot walking.</p>
<p>The spec says the robot must stay upright after a push of up to 250 N. The video shows one push. Nothing ties the claim to the sentence, and nothing says what happens at 62 N from the wrong direction.</p>
<p>GOLEM turns each acceptance criterion of a Kiro spec into a physics property test. It searches for the push, the payload or the delay that breaks the sentence, and it saves what it finds. On the G1 controller in this repository, <code>golem gate</code> exits with code 2 and names ${gate.broken} of the ${gate.total} lines as not held. The agent’s claim of “done” has to survive that.</p>

<section class="bleed" aria-labelledby="how"><div class="bleed-in">
<h2 id="how">How it works</h2>
<ol class="pipeline">${pipeline(d)}</ol>
<p class="alt">All six figures use files committed in this repository: the G1 requirements, the stability map, a pinned seed and the output of <code>golem gate</code>. Where a figure shows a mechanism on one cell, its caption says which.</p>
</div></section>

<h2 id="robots">Two robots</h2>
<div class="cards">
<article class="card"><h3>Stagger: a Unitree G1</h3><p>A 12-joint-leg humanoid walking under Unitree’s published policy. ${g1?.lines.length ?? 0} requirement lines cover push recovery, speed tracking, slopes, payload, slipping and sensor latency. ${expectedBreaks} of them are written to break.</p><p><a class="btn" href="/stagger/">Open the G1 studio</a></p></article>
<article class="card"><h3>Candy: a Franka Panda</h3><p>A suction cup sorts Halloween candy into bowls while a trick-or-treater’s hand reaches into the workspace. ${candy?.lines.length ?? 0} lines cover task success and speed-and-separation safety near hands.</p><p><a class="btn" href="/candy/">Open the candy studio</a></p></article>
</div>

<h2 id="results">Measured results</h2>
<p>These are measurements, with their budgets. The <a href="/evidence/">evidence page</a> has the methods and the raw files.</p>
<div class="stats">
<div class="stat"><b>${fmt(h.weakN)} N</b><span>The G1’s weakest direction: ${h.weakDir}° at stride phase ${h.weakPhase}.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b>${fmt(h.strongN)} N</b><span>Its strongest direction: ${h.strongDir}°. The range is ${fmt(h.strongN - h.weakN)} N, a factor of ${fmt(h.strongN / h.weakN)}.</span><a href="/evidence/#map">The stability map</a></div>
<div class="stat"><b>${h.candyBroken} of ${h.candyTrials}</b><span>Candy trials that break “keep every link 0.10 m from the hand”. The closest link is the wrist (link7) in ${h.candyLink7}, the cup in ${h.candyCup}. Worst margin ${fmt(h.candyWorstM, 3)} m.</span><a href="/evidence/#candy">The candy measurement</a></div>
<div class="stat"><b>${r12.guided.found}/${r12.guided.n} and ${r12.random.found}/${r12.random.n}</b><span>Line 1.2 found by guided search and by random sampling, at budget ${budget}. On these lines guided search is no better than random.</span><a href="/evidence/#benchmark">The benchmark</a></div>
</div>

<h2 id="kit">The kit in 60 seconds</h2>
<p>The skeleton is a package, <code>golem-spec</code>, with one command, <code>golem</code>. In an app directory:</p>
${codeBlock(`golem init                    # install hooks, steering, agents and skills into .kiro/
golem check                   # compile every EARS line; no trials
golem test --budget 48        # random, then guided, then shrink
golem falsify 1.3 --budget 96 # hunt one line
golem replay 1.3              # re-run the pinned counterexample
golem gate                    # exit 0 only if every line holds`, 'the kit commands')}
<p>A real run on the G1 (Node 21, Windows): <code>golem check</code> compiles 11 lines in under a second, and <code>golem gate</code> exits ${gate.exit} after ${gate.seconds} s with “gate RED: ${gate.broken} of ${gate.total} requirements are not held”. The same tools reach agents through an MCP server with eight tools. <a href="/kit/">Read the kit page</a>.</p>

<h2 id="limits">Limits, stated plainly</h2>
<ul>
<li><b>“Held” means no counterexample was found within the budget.</b> It is not a proof. The report always states the budget, for example ${budget} trials per line.</li>
<li><b>This is simulation.</b> MuJoCo models a G1 and a Panda. No real robot ran any of these tests, and the contact model is not the floor in your lab.</li>
<li><b>One policy.</b> The G1 results are for Unitree’s published walking policy. Nothing here says how another controller behaves.</li>
<li><b>Guided search did not beat random sampling</b> on the four G1 lines at budget ${budget}. It does on a synthetic narrow region. <a href="/evidence/#benchmark">Both results are on the evidence page.</a></li>
<li><b>The agent-gate experiment has not run.</b> Whether the Stop gate stops false “done” claims is untested; the evidence page shows it as pending.</li>
</ul>

<h2 id="start">Break the golem, then fix it</h2>
<p class="lede">Shove the G1, read the sentence that broke, then see how the kit would hand that failure to an agent.</p>
<div class="btn-row"><a class="btn" href="/stagger/">Shove the G1</a><a class="btn" href="/evidence/">Read the evidence</a><a class="btn" href="/kit/">Use the kit</a><a class="btn" href="${REPO_URL}" rel="noopener">View the source</a></div>
<p class="small muted">The requirement the first figure shows reads: ${earsHtml(g1?.lines.find((l) => l.id === '1.2')?.source ?? '')}</p>
`;
  return {
    id: 'home', path: '/',
    title: 'GOLEM: EARS requirements that run as physics tests',
    description: 'GOLEM turns the EARS acceptance criteria of a Kiro spec into MuJoCo property tests, searches for counterexamples and gates the AI agent until every requirement holds.',
    body, modules: ['/src/studio/load.ts'],
    head: '<link rel="preload" as="image" href="/poster-dark-narrow.jpg" media="(max-width:1023px)" fetchpriority="high">\n<link rel="preload" as="image" href="/poster-dark-wide.jpg" media="(min-width:1024px)" fetchpriority="high">',
  };
}
