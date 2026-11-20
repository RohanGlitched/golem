// The kit page: CLI with real output, MCP tools, hooks, agents, skills, Power, workflow, Crew app, and the EARS dialect from both lexicons.
import type { LexiconRef, SiteData } from '../build/data';
import { codeBlock, earsHtml, esc, table } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { clip, excerpt, mcpCallBlock, parseTranscript } from '../build/transcript';
import type { TranscriptSection } from '../build/transcript';
import { frontMatter, readRepoJson, readRepoText } from '../build/repo';
import type { HookDef, HookFile } from '../build/repo';

const USAGE: Record<string, string> = {
  check: 'golem check [file] [--app <dir>] [--json]',
  test: 'golem test [--req <id>] [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--app <dir>] [--json]',
  falsify: 'golem falsify <reqId> [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--app <dir>] [--json]',
  replay: 'golem replay <reqId> [--seed <n>] [--app <dir>] [--json]',
  gate: 'golem gate [--kiro] [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--confirm-budget <n>] [--no-confirm] [--app <dir>] [--json]',
  init: 'golem init [dir] [--force]',
  mcp: 'golem mcp [--app <dir>]',
};

const WHAT: Record<string, string> = {
  check: 'Compiles every EARS line against the app lexicon. No trial runs. Exit 0 when all lines compile.',
  test: 'Runs every requirement: pinned seeds, random trials, guided search, shrinking. Exit 2 when any line is broken.',
  falsify: 'Hunts one requirement. Pinned seeds re-run first.',
  replay: 'Re-runs a pinned counterexample exactly and writes its trace to .golem/replays/.',
  gate: 'Exit 0 only when every line meets its row of the Expectation table (Expected_Hold holds, Expected_Break breaks; no row means Expected_Hold) and no pinned seed fails. From golem-spec 0.1.2 (in the repository; not yet on npm), before it prints green it searches every Expected_Hold line again with a second search seed derived from the first (--confirm-budget sets that budget, --no-confirm skips it); a line that breaks the second time makes the gate red. With --kiro it blocks an agent Stop with JSON on stdout and exits 0.',
  init: 'Copies the Kiro pack (hooks, steering, agents, skills, MCP entry) into the project .kiro/.',
  mcp: 'Starts the stdio MCP server for Kiro agents.',
};

function section(ts: TranscriptSection[], cmd: string): TranscriptSection {
  const s = ts.find((x) => x.command === cmd || x.command.startsWith(`${cmd} `));
  if (!s) throw new Error(`docs/cli-transcript.md has no section for "${cmd}"`);
  return s;
}

function cliBlock(name: string, s: TranscriptSection | undefined, maxLines: number): string {
  let out = `<h3 id="cmd-${name}"><code>golem ${name}</code></h3><p>${esc(WHAT[name] as string)}</p>${codeBlock(USAGE[name] as string, `usage of golem ${name}`)}`;
  if (s) {
    const ex = excerpt(s.code.split('\n').map((l) => clip(l, 260)).join('\n'), maxLines);
    const more = ex.omitted > 0 ? `\n... ${ex.omitted} more lines in docs/cli-transcript.md` : '';
    out += `<p class="small muted">Real output, ${esc(s.title)}. Node 21 on Windows, the G1 app, 11 lines.</p>${codeBlock(ex.text + more, `output of golem ${name}`)}`;
  } else {
    out += `<p class="small muted">No recorded output for this command in the transcript.</p>`;
  }
  return out;
}

function mcpTools(): string {
  const md = readRepoText('skeleton/power/POWER.md');
  const sec = /## MCP tools([\s\S]*?)\n## /.exec(md);
  const rows = [...(sec?.[1] ?? '').matchAll(/^- `([a-z_]+)`: (.+)$/gm)].map((m) => [`<code>${m[1]}</code>`, esc(m[2] as string)]);
  if (rows.length === 0) throw new Error('skeleton/power/POWER.md: no MCP tool list found');
  return table(['Tool', 'What it does'], rows, { caption: `The ${rows.length} tools of the golem MCP server` });
}

// .kiro/hooks/build.json has single backslashes in two matchers (invalid JSON, reported on /how-kiro).
// Read it leniently so the page still lists the hooks.
function readHooks(rel: string): HookDef[] {
  const text = readRepoText(rel);
  try {
    return (JSON.parse(text) as HookFile).hooks;
  } catch {
    return (JSON.parse(text.replace(/\\(?![\\"/bfnrtu])/g, '\\\\')) as HookFile).hooks;
  }
}

function hooksTable(): string {
  const files: [string, string][] = [
    ['Installed by golem init', 'skeleton/kiro-pack/hooks/golem.json'],
    ['This repository', '.kiro/hooks/build.json'],
  ];
  const rows: string[][] = [];
  for (const [scope, f] of files) {
    for (const h of readHooks(f)) {
      rows.push([esc(scope), esc(h.name), `<code>${esc(h.trigger)}</code>`, `<code>${esc(h.action.command)}</code>`, h.timeout ? `${h.timeout} s` : '']);
    }
  }
  return table(['Scope', 'Hook', 'Trigger', 'Command', 'Timeout'], rows, { caption: 'Kiro hooks in the repository', num: [4] });
}

function agentsTable(): string {
  const rows: string[][] = [];
  for (const n of ['golem-tuner', 'golem-skeptic', 'golem-scribe']) {
    const j = readRepoJson<{ name: string; description: string }>(`skeleton/kiro-pack/agent-src/${n}.json`);
    rows.push([`<code>${esc(j.name)}</code>`, esc(j.description), 'installed by golem init']);
  }
  const a = readRepoJson<{ name: string; description: string }>('.kiro/agents/golem-auditor.json');
  rows.push([`<code>${esc(a.name)}</code>`, esc(a.description), 'this repository only']);
  return table(['Agent', 'Job', 'Where'], rows, { caption: 'Kiro agents' });
}

function skillsTable(): string {
  const rows = ['robot-ears', 'falsify-and-fix'].map((n) => {
    const fm = frontMatter(readRepoText(`skeleton/kiro-pack/skills/${n}/SKILL.md`));
    return [`<code>${esc(fm['name'] ?? n)}</code>`, esc(fm['description'] ?? '')];
  });
  return table(['Skill', 'When it applies'], rows, { caption: 'Kiro skills' });
}

function dialect(l: LexiconRef): string {
  const preds = l.predicates.map((p) => [earsHtml(p.phrase.replace(/\{(\w+)\}/g, '{$1}')), `<code>${esc(p.unit)}</code>`, p.signals.map((s) => `<code>${esc(s)}</code>`).join(' ')]);
  const perts = l.perturbations.map((p) => [earsHtml(p.phrase), p.maxOnset ? `${p.maxOnset} s` : '']);
  return `<h3 id="lex-${l.app}">${esc(l.name)}</h3>
<p class="small muted">The robot may be called ${l.robotNames.map((r) => `<code>${esc(r)}</code>`).join(', ')} after THE.</p>
${table(['Response phrase', 'Unit', 'Signals read'], preds, { caption: `Responses (SHALL ...) in the ${l.app} lexicon` })}
${table(['Trigger, state or fault phrase', 'Latest onset'], perts, { caption: `Perturbations (WHEN, WHILE, IF) in the ${l.app} lexicon`, num: [1] })}
<details><summary>The ${l.lines.length} compiled lines, with the search space each one defines</summary>
${table(['Id', 'Pattern', 'Line', 'Searched dimensions'], l.lines.map((x) => [esc(x.id), esc(x.pattern), earsHtml(x.source), x.dims.filter((d) => d.min !== d.max).map((d) => `<code>${esc(d.name)}</code>`).join(' ') || 'none'] ), { caption: `Lines of the ${l.app} app` })}</details>`;
}

export function kitPage(d: SiteData): PageSpec {
  const ts = parseTranscript(d.transcriptMd);
  const byName = (n: string): TranscriptSection | undefined => ts.find((x) => x.command === `golem ${n}` || x.command.startsWith(`golem ${n} `));
  const wf = readRepoText('skeleton/kiro-pack/workflows/falsify-and-fix.workflow.json').trim();
  const crew = readRepoJson<{ displayName: string; description: string; crons: { cron_expr: string; agent: string }[]; permissions: { network: boolean } }>('skeleton/crew-app/app.json');
  const power = frontMatter(readRepoText('skeleton/power/POWER.md'));
  const steer = readRepoText('skeleton/kiro-pack/steering/golem-ears.md').length;
  section(ts, 'golem gate');
  const reflexGate = ts.find((x) => x.command === 'GOLEM_REFLEX=kiro golem gate');
  if (!reflexGate) throw new Error('docs/cli-transcript.md has no section for "GOLEM_REFLEX=kiro golem gate"');
  const mcpCall = mcpCallBlock(byName('mcp')?.code ?? '', 'falsify', 400);
  const body = `
<h1>The kit</h1>
<p class="lede">One package, <code>golem-spec</code>, with one command, <code>golem</code>. It reads the EARS lines of a Kiro spec, runs them as physics tests, and hands counterexamples to the agent.</p>
<p>The output below is copied from <code>docs/cli-transcript.md</code>, a run on the real G1 app. Long blocks are cut at the line shown and the file has the rest.</p>

<h2 id="cli">Commands</h2>
${cliBlock('check', byName('check'), 6)}
${cliBlock('test', byName('test'), 8)}
${cliBlock('falsify', byName('falsify'), 6)}
${cliBlock('replay', byName('replay'), 8)}
${cliBlock('gate', byName('gate'), 24)}
<p>The same gate with Kiro's balance reflex (<code>GOLEM_REFLEX=kiro</code>), where requirement 1.3 now holds:</p>
${codeBlock(excerpt(reflexGate.code.split('\n').map((l) => clip(l, 260)).join('\n'), 30).text, 'output of golem gate with the Kiro reflex')}
${cliBlock('init', undefined, 0)}
${cliBlock('mcp', byName('mcp'), 10)}

<h2 id="mcp">MCP tools</h2>
<p><code>golem mcp</code> speaks MCP over stdio. A Kiro agent gets these tools, so it can falsify, read a counterexample and explain the margin without a shell.</p>
${mcpTools()}
<p>A call, as recorded in the transcript:</p>
${codeBlock(mcpCall, 'an MCP falsify call')}
<p class="small muted">Tool calls return a one-line summary and then a JSON block. See the <a href="${REPO_URL}/blob/main/docs/cli-transcript.md">full transcript</a>.</p>

<h2 id="hooks">Hooks</h2>
<p>The Stop hook is the gate: while a line is red, <code>golem gate --kiro</code> blocks the stop and returns the counterexamples as the agent's next message. Kiro fires it once per user turn, so the repair loop also lives in the tuner agent and the workflow below.</p>
${hooksTable()}

<h2 id="agents">Agents</h2>
${agentsTable()}
<p>The tuner never edits a requirement. A guard hook denies writes to <code>requirements.md</code> for that agent. New lines go through the <code>propose_requirement</code> tool into <code>proposals.md</code> for a human.</p>

<h2 id="skills">Skills and steering</h2>
${skillsTable()}
<p>The steering file <code>golem-ears.md</code> (${steer.toLocaleString('en-US')} bytes) is included whenever a <code>requirements.md</code> is open.</p>

<h2 id="power">Power, workflow and Crew app</h2>
<h3>Power</h3>
<p>The <code>${esc(power['name'] ?? 'golem')}</code> Power bundles the MCP server, the skills and the steering: ${esc(power['description'] ?? '')}</p>
<p>Tried in kiro-cli 3.5.0: <code>kiro-cli powers install ./skeleton/power</code> installs it, and its two skills appear in every session. Its MCP server did not start in headless sessions, so the MCP tools come from the <code>.kiro/settings/mcp.json</code> that <code>golem init</code> writes. The sessions and their logs: <a href="${REPO_URL}/tree/main/evidence/results/power"><code>evidence/results/power/</code></a>.</p>
<h3>Workflow</h3>
<p>The <code>falsify-and-fix</code> workflow repeats the tuner and <code>golem gate</code> up to 6 times and pauses if the gate is still red. The kit README marks its file format as the least verified part of the pack.</p>
${codeBlock(wf, 'the workflow file')}
<h3>Crew app</h3>
<p><b>${esc(crew.displayName)}</b>: ${esc(crew.description)} It runs the agent <code>${esc(crew.crons[0]!.agent)}</code> on the cron expression <code>${esc(crew.crons[0]!.cron_expr)}</code> with network permission ${crew.permissions.network ? 'on' : 'off'}, and ends each run with a summary in the run’s output. The manifest follows the documented Crew fields (<code>crons</code>, <code>permissions</code>, store assets). It has not been installed on a live Crew gateway.</p>

<h2 id="ears">The EARS dialect</h2>
<p>GOLEM accepts Kiro's five EARS patterns. Every number carries a unit; a line that matches no phrase fails <code>golem check</code> with the closest phrase as the suggestion. The tables below are generated from the two <code>lexicon.ts</code> files.</p>
${table(['Pattern', 'Shape', 'Becomes'], [
    ['Ubiquitous', earsHtml('THE robot SHALL <response>'), 'The response holds for the whole episode after warm-up.'],
    ['Event', earsHtml('WHEN <trigger> THE robot SHALL <response>'), 'The trigger is injected, and the response is checked over the window after it.'],
    ['State', earsHtml('WHILE <state> THE robot SHALL <response>'), 'The state is applied for the episode, or checked at each instant.'],
    ['Unwanted', earsHtml('IF <fault> THEN THE robot SHALL <response>'), 'The fault is injected like a trigger.'],
    ['Optional', earsHtml('WHERE <feature> THE robot SHALL <response>'), 'Applies only when the app enables the feature.'],
  ], { caption: 'The five patterns' })}
<p>Ranges in a trigger are the search space: <code>up to 200 N</code> is force from 0 to 200 N, <code>from any direction</code> is 0 to 360 deg, <code>at any point in its stride</code> is gait phase 0 to 1. A single value, such as <code>for 0.2 s</code>, is fixed.</p>
${d.lexicons.map(dialect).join('\n')}
`;
  return {
    id: 'kit', path: '/kit/', title: 'The kit',
    description: 'The golem CLI, MCP tools, Kiro hooks, agents, skills, Power and Crew app, with real output, and the EARS dialect of both robots.',
    body, modules: [],
  };
}
