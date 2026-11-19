// How Kiro built GOLEM: generated from site/data/kiro.json and the committed audits.
import type { KiroSpec, SiteData } from '../build/data';
import { esc, fmt, inlineMd, table } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { readRepoJson, readRepoText } from '../build/repo';
import type { HookFile } from '../build/repo';

const AUDITS: { name: string; file: string; fix: string; what: string }[] = [
  { name: 'golem-ears', file: 'docs/reviews/ears-audit.md', fix: 'golem-ears-hardening', what: 'the EARS compiler and monitors' },
  { name: 'golem-sim', file: 'docs/reviews/sim-audit.md', fix: 'golem-sim-hardening', what: 'the MuJoCo episode runner' },
  { name: 'golem-falsify and pool', file: 'docs/reviews/falsify-audit.md', fix: 'golem-falsify-hardening', what: 'the falsifier and trial pool' },
];

const link = (rel: string): string => `<a href="${REPO_URL}/blob/main/${rel}"><code>${esc(rel)}</code></a>`;

function specRow(s: KiroSpec): string[] {
  const total = s.tasksDone + s.tasksOpen;
  return [`<code>${esc(s.name)}</code>`, esc(s.type), String(s.requirements), String(s.earsCriteria), String(s.properties), total === 0 ? '0' : `${s.tasksDone}/${total}`];
}

function auditCard(d: SiteData, a: (typeof AUDITS)[number], specs: KiroSpec[]): string {
  const text = d.reviews.find((r) => r.file === a.file)?.text ?? readRepoText(a.file);
  const verdict = /\*\*Verdict:?\s*([^*]+?)\*\*\s*(.*)/.exec(text)?.[1]?.trim() ?? /Verdict:\s*(.+)/.exec(text)?.[1]?.trim() ?? 'see the file';
  const fix = specs.find((s) => s.name === a.fix);
  return `<article class="card"><h3>${esc(a.name)}</h3><p>An independent review of ${esc(a.what)}. Verdict: <b>${esc(verdict.replace(/\.$/, ''))}</b>.</p><p>Bugfix spec: <code>${esc(a.fix)}</code>${fix ? `, ${fix.tasksDone} of ${fix.tasksDone + fix.tasksOpen} tasks done` : ''}.</p><p class="small">${link(a.file)}</p></article>`;
}

export function howKiroPage(d: SiteData): PageSpec {
  const k = d.kiro;
  const t = k.totals;
  const specs = k.workspaces.flatMap((w) => w.specs);
  const root = k.workspaces.find((w) => w.path === '.kiro');
  if (!root) throw new Error('site/data/kiro.json has no root .kiro workspace');
  const rootHooks = (() => {
    const text = readRepoText('.kiro/hooks/build.json');
    try { return (JSON.parse(text) as HookFile).hooks; } catch { return (JSON.parse(text.replace(/\\(?![\\"/bfnrtu])/g, '\\\\')) as HookFile).hooks; }
  })();
  const appHooks = k.workspaces.filter((w) => w.path !== '.kiro').flatMap((w) => w.hooks.map((h) => ({ ...h, ws: w.path })));
  const kitHooks = readRepoJson<HookFile>('skeleton/kiro-pack/hooks/golem.json').hooks;
  const prefixes = Object.entries(k.commits.byPrefix).filter(([p]) => p !== 'other' && p !== 'merge').sort((a, b) => b[1] - a[1]);
  const gen = k.generated.slice(0, 10);
  const specRows = specs.map(specRow);
  const earsTotal = specs.reduce((a, s) => a + s.earsCriteria, 0);

  const body = `
<h1>How Kiro built it</h1>
<p class="lede">Kiro wrote and ran GOLEM's own specs. This page is generated from <code>site/data/kiro.json</code>, which <code>node scripts/kiro-stats.mjs</code> counts from the files in this repository (generated ${esc(gen)} at commit <code>${esc(k.commit)}</code>).</p>
<div class="stats">
<div class="stat"><b>${t['specs']}</b><span>specs, ${t['bugfixSpecs']} of them bugfix specs written from audits</span></div>
<div class="stat"><b>${t['requirements']}</b><span>requirements with ${t['earsCriteria']?.toLocaleString('en-US')} EARS acceptance criteria</span></div>
<div class="stat"><b>${t['properties']}</b><span>correctness properties in the designs</span></div>
<div class="stat"><b>${t['tasksDone']}</b><span>tasks completed. ${k.tests.propertyAsserts} property assertions (<code>fc.assert</code>) in ${k.tests.files} test files</span></div>
</div>

<h2 id="tuner">The best session: a Kiro agent fixing the robot under the gate</h2>
<p class="lede">The task: make requirement 1.3 hold (a 100 N push from any direction), changing only <code>controller/reflex.ts</code>, without breaking any line that holds today. The agent was <code>golem-tuner</code> from the kit pack, run headless in Kiro CLI on Opus 5.5. It took 13.6 minutes and 11.3 credits.</p>
<ol class="try-steps">
<li><b>It used GOLEM to look first.</b> Through the MCP server it called <code>list_requirements</code>, <code>falsify</code>, <code>get_counterexample</code>, <code>explain_margin</code> and <code>replay</code> before touching code. The counterexample: 55.6 N, early in the stride, below even line 1.1’s 60 N.</li>
<li><b>Its first reflex made 1.3 hold and broke two other lines.</b> Correcting forward speed too, it fell on a 6.89° slope (3.1) and at 30.2 ms of sensor latency (6.1). GOLEM caught both on the next <code>golem test</code>.</li>
<li><b>It narrowed the reflex.</b> Sideways only, and only sudden changes: smooth over 0.06 s, subtract a 1.5 s average, so a push counts and a slope’s steady drift does not. 3.1 and 6.1 held again.</li>
<li><b>A different search seed broke it again.</b> With a gain of 1.6, 1.3 fell at 79.9 N from 108°: the command outran the robot and it kept accelerating sideways. A gain of 0.8 held under the default search and three more search seeds.</li>
<li><b>It stopped honestly.</b> The gate was still red, only on the three lines marked Expected_Break, and it said so: the gate did not read the Expectation table yet. It also reported that the MCP server kept running the old reflex after the edit, and that our push-angle convention looked backwards. Both were real bugs, and both were fixed afterwards.</li>
</ol>
<p>The reflex ships as a switch, <code>GOLEM_REFLEX=kiro</code>. Re-measured afterwards over the full 4,860-trial stability map, the weakest push it survives rose from 62.5 N to 101.6 N, and all 36 directions hold 100 N (<a href="/evidence/#kiro-reflex">evidence</a>). The prompt and the full session log are in <a href="${REPO_URL}/tree/main/evidence/results/tuner"><code>evidence/results/tuner/</code></a>; the logs of every other Kiro session are in <a href="${REPO_URL}/tree/main/evidence/kiro-sessions"><code>evidence/kiro-sessions/</code></a>.</p>

<h2 id="specs">Every spec</h2>
<p>${specs.length} specs, ${earsTotal.toLocaleString('en-US')} EARS criteria. Bugfix specs have no requirements file of their own: they list tasks that fix the defects of an audit. The G1 and candy rows are the robots' own requirement files, which GOLEM tests.</p>
${table(['Spec', 'Type', 'Requirements', 'EARS criteria', 'Properties', 'Tasks done'], specRows, { caption: 'Specs across .kiro, apps/stagger/.kiro and apps/candy/.kiro', num: [2, 3, 4, 5] })}

<h2 id="config">What is in .kiro</h2>
<h3>Steering</h3>
<p>${root.steering.map((s) => `<code>${esc(s)}</code>`).join(', ')}. Two of them bind the look and the experience of the site and the studios: <code>design-language.md</code> and <code>experience.md</code>.</p>
<h3>Hooks</h3>
${table(['Where', 'Hook', 'Trigger'], [
    ...rootHooks.map((h) => ['this repository', esc(h.name), `<code>${esc(h.trigger)}</code>`]),
    ...appHooks.map((h) => [esc(h.ws.replace(/\/\.kiro$/, '')), esc(h.name), `<code>${esc(h.trigger)}</code>`]),
    ...kitHooks.map((h) => ['golem init pack', esc(h.name), `<code>${esc(h.trigger)}</code>`]),
  ], { caption: 'Hooks' })}
<h3>Agents, MCP servers, skills, workflow, Power and Crew app</h3>
<ul>
<li><b>Agents:</b> ${root.agents.map((a) => `<code>${esc(a.name)}</code>`).join(', ')} for review in this repository, pinned to <code>claude-sonnet-5.5</code>. The kit pack adds <code>golem-tuner</code>, <code>golem-skeptic</code> and <code>golem-scribe</code>.</li>
<li><b>MCP servers:</b> ${root.mcp.map((m) => `<code>${esc(m)}</code>`).join(', ')}. Each starts <code>golem mcp</code> for one robot.</li>
<li><b>Skills:</b> ${(k.workspaces.flatMap((w) => w.skills).filter((s, i, a) => a.indexOf(s) === i)).map((s) => `<code>${esc(s)}</code>`).join(', ')}.</li>
<li><b>Workflow:</b> <code>falsify-and-fix</code>, a repeat of the tuner and <code>golem gate</code> up to 6 times.</li>
<li><b>Power and Crew app:</b> <code>skeleton/power</code> and <code>skeleton/crew-app</code> (the night watch). See <a href="/kit/#power">the kit page</a>.</li>
</ul>

<h2 id="surfaces">Which Kiro surface did what</h2>
<ul>
<li><b>Kiro CLI v3, headless, spec mode</b> wrote the requirements, designs and tasks of the feature specs and the three bugfix specs.</li>
<li><b>Kiro CLI v3, headless, default mode</b> carried out the tasks and committed them by task; commit subjects start with the spec name, for example <code>golem-ears-hardening: 7 ...</code>. Some sessions committed several finished tasks in a burst at the end of the run, so a few commits are seconds apart. The raw log of every session is in <code>evidence/kiro-sessions/</code>.</li>
<li><b>Models:</b> Opus 5.5 and Sonnet 5.5. The <code>golem-auditor</code> agent is pinned to Sonnet 5.5.</li>
<li><b>Hooks:</b> the Stop gate and the save hooks above ran inside those sessions. Hook behaviour was checked on kiro-cli 3.5.0: a Stop hook that blocks continues the agent, but fires once per user turn.</li>
</ul>
<p class="small muted">${k.commits.total} commits counted. By spec prefix: ${prefixes.slice(0, 10).map(([p, n]) => `${esc(p)} ${n}`).join(', ')}.</p>

<h2 id="audits">Three independent audits</h2>
<p>After the engine specs were done, a separate agent reviewed each module with probes against real inputs, not the module's own tests. Each audit became a bugfix spec.</p>
<div class="cards">${AUDITS.map((a) => auditCard(d, a, specs)).join('')}</div>

<h2 id="wrong">What went wrong</h2>
<h3>The push direction never reached the simulator</h3>
<p>All tests passed, and the G1 pushes ignored their direction. The ears audit found it (defect 1): the compiler matched a dimension to the perturbation only by name, and the direction slot's dimension is called <code>push.angle</code>. A test hid it with a loose <code>toMatchObject</code>. The first run of the stability map was made on that build, so every direction gave the same boundary. That run is kept as invalid in <code>evidence/results/invalid/</code>, and the valid map was re-run after the fix. See ${link('docs/reviews/ears-audit.md')}.</p>
<h3>The fallen margin was too flat for guided search</h3>
<p>A fall scored a fixed −0.01 m. The cross-entropy search needs a slope, and flat robustness made it lose to random sampling on a synthetic needle (9/30 against 21/30 at budget 1000 before the fix, the falsify audit's defect 2; 15/30 against 22/30 after it). The G1 app then got a graded margin (height and tilt headroom, same verdict), and the benchmark was run again. On the real G1 lines the arms still tied at budget 96. See <a href="/evidence/#benchmark">the benchmark</a>.</p>
<h3>The scheduler doubled frames</h3>
<p>In the studio, a render tick that called <code>requestOnce</code> while a reason to render was held queued a second animation-frame callback. The callbacks doubled every frame, and the G1 page took seconds per frame. It was found in the browser while building the signature moments, fixed in <code>RenderScheduler</code>, and given a regression test (commit <code>3d9f56c</code>).</p>
<h3>Smaller ones, found while building this site</h3>
<ul>
<li>The root <code>.kiro/hooks/build.json</code> is not valid JSON: two matchers hold single backslashes. <code>kiro-stats.mjs</code> therefore counts no hooks for the root workspace, and Kiro may not load that file. The site reads it leniently.</li>
<li>The needle log <code>docs/reviews/falsify-hardening-runs/after-search.txt</code> is UTF-16 (a shell redirect wrote it). The site decodes it.</li>
<li>The evidence report's pre-registered prediction for line 1.3 was wrong, and the agent-gate experiment has not run. Both are stated on the <a href="/evidence/">evidence page</a>.</li>
</ul>
<p class="small muted">Counts above: ${fmt(t['tasksDone'] ?? 0, 0)} tasks done of ${(t['tasksDone'] ?? 0) + (t['tasksOpen'] ?? 0)} counted in the markdown task lists. ${inlineMd('The `golem-cloud` spec is written and not started; it is not part of this build.')}</p>
`;
  return {
    id: 'how-kiro', path: '/how-kiro/', title: 'How Kiro built it',
    description: `${t['specs']} specs, ${t['requirements']} requirements and ${t['earsCriteria']?.toLocaleString('en-US')} EARS criteria: the Kiro specs, hooks, agents and audits behind GOLEM, and what went wrong.`,
    body, modules: [],
  };
}
