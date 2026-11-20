// The yard page: one requirements file on seven MuJoCo Menagerie robots, read from apps/yard/board.json.
import { codeBlock, earsHtml, esc, table } from '../build/html';
import type { PageSpec } from '../build/layout';
import { REPO_URL } from '../build/layout';
import { readRepoJson, readRepoText } from '../build/repo';

export interface YardLine {
  id: string; status: string; trials: number; closest: number | null;
  counterexample: { weight: number; deg: number; shrunk: boolean } | null;
}
export interface YardRow {
  id: string; name: string; kind: string; folder: string;
  lines: YardLine[];
  rose: { deg: number; breaks: number | null }[];
  weakest: { deg: number; breaks: number } | null;
  strongestBreak: number | null;
  seconds: { verdicts: number; rose: number };
}
export interface YardBoard {
  commit: string; requirements: string; budget: number; searchSeed: number; directions: number; bisectSteps: number;
  robots: YardRow[];
}

/** The four push lines of requirement 1, as rings: share of the robot's weight. */
const RINGS = [
  { id: '1.1', r: 0.1 }, { id: '1.2', r: 0.25 }, { id: '1.3', r: 0.5 }, { id: '1.4', r: 1 },
];

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

/** The side a push comes from, in words, for a direction in degrees (0 the front, 90 the left). */
export function sideName(deg: number): string {
  const names = ['the front', 'front left', 'the left', 'back left', 'behind', 'back right', 'the right', 'front right'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8] as string;
}

/**
 * A stance rose: the smallest push that topples the robot, by direction. The radius is the push as a share of the
 * robot's weight on a square-root scale (so 10% and 25% stay readable next to 100%); the rings are the four push lines.
 * Up is the robot's front, left is its left, as seen from above. A direction that holds at 100% reaches the outer ring.
 */
export function roseSvg(row: YardRow, size = 260): string {
  const c = size / 2, R = size / 2 - 26;
  const rad = (ratio: number): number => R * Math.sqrt(Math.max(0, Math.min(1, ratio)));
  // 0 deg (the front) is up; 90 deg (the left) is to the left: x = -sin, y = -cos in screen coordinates.
  const at = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [c - r * Math.sin(a), c - r * Math.cos(a)];
  };
  const rings = RINGS.map((g) => {
    const r = rad(g.r);
    return `<circle class="ring" cx="${c}" cy="${c}" r="${r.toFixed(1)}"/><text x="${(c + 3).toFixed(1)}" y="${(c - r - 3).toFixed(1)}" class="ring-label">${pct(g.r)}</text>`;
  }).join('');
  const pts = row.rose.map((p) => at(p.deg, rad(p.breaks === null ? 1 : p.breaks)));
  const path = pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z` : '';
  const dots = row.rose.map((p, i) => {
    const [x, y] = pts[i] as [number, number];
    const label = p.breaks === null ? `From ${sideName(p.deg)} (${p.deg} deg): holds at 100% of its weight` : `From ${sideName(p.deg)} (${p.deg} deg): topples at ${pct(p.breaks)} of its weight`;
    return `<circle class="${p.breaks === null ? 'dot held-dot' : 'dot'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p.breaks === null ? 3 : 2.4}"><title>${esc(label)}</title></circle>`;
  }).join('');
  const w = row.weakest;
  const weakMark = w && w.breaks > 0 ? (() => {
    const [x, y] = at(w.deg, rad(w.breaks));
    return `<line class="weak-ray" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  })() : '';
  const fallen = row.rose.every((p) => p.breaks === 0);
  const desc = fallen
    ? `${row.name} falls with no push at all.`
    : `${row.name}: the smallest push that topples it is ${w ? `${pct(w.breaks)} of its weight from ${sideName(w.deg)}` : 'above 100% of its weight from every direction'}.`;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(desc)}">
<line class="axis" x1="${c}" y1="12" x2="${c}" y2="${size - 12}"/><line class="axis" x1="12" y1="${c}" x2="${size - 12}" y2="${c}"/>
${rings}
${fallen ? `<circle class="fallen" cx="${c}" cy="${c}" r="5"/>` : `<path class="rose" d="${path}"/>${weakMark}${dots}`}
<text x="${c}" y="10" text-anchor="middle" class="dir">front</text><text x="4" y="${c + 4}" class="dir">left</text><text x="${size - 4}" y="${c + 4}" text-anchor="end" class="dir">right</text><text x="${c}" y="${size - 2}" text-anchor="middle" class="dir">behind</text>
</svg>`;
}

const roseAt = (r: YardRow | undefined, deg: number): number | null | undefined => r?.rose.find((p) => p.deg === deg)?.breaks;
const pctOr = (x: number | null | undefined): string => (x === null ? 'more than 100%' : x === undefined ? '?' : pct(x));

/** The findings list, computed from the board so it cannot drift from the data. */
export function findings(robots: YardRow[]): string {
  const by = (id: string): YardRow | undefined => robots.find((r) => r.id === id);
  const out: string[] = [];
  const dogs = ['go1', 'a1', 'spot'].map(by).filter((r): r is YardRow => r !== undefined);
  if (dogs.length) {
    const side = (r: YardRow): number => Math.min(...[90, 270].map((d) => roseAt(r, d) ?? 1));
    const frontHolds = dogs.every((r) => roseAt(r, 0) === null);
    out.push(`<li><b>Dogs fall sideways.</b> ${dogs.map((r) => r.name.replace(/^Unitree |^Boston Dynamics /, '')).join(', ').replace(/, ([^,]+)$/, ' and $1')} topple at ${dogs.map((r) => pct(side(r))).join(', ').replace(/, ([^,]+)$/, ' and $1')} of their weight pushed from the side${frontHolds ? ', yet each holds 100% pushed straight from the front' : ''}.</li>`);
  }
  const any = by('anymal_c');
  if (any && roseAt(any, 0) !== undefined) {
    out.push(`<li><b>ANYmal C is the other way round.</b> It is weakest pushed from the front or behind (${pctOr(roseAt(any, 0))} and ${pctOr(roseAt(any, 180))}) and takes ${pctOr(roseAt(any, 90))} from the side: its rose is a rounded square where the other dogs' are long ovals.</li>`);
  }
  const g1 = by('g1');
  if (g1?.weakest) {
    const l11 = g1.lines.find((l) => l.id === '1.1')?.status, l12 = g1.lines.find((l) => l.id === '1.2')?.status;
    out.push(`<li><b>The G1 stands, barely.</b> The 29-joint G1 holds its stand pose but topples at ${pct(g1.weakest.breaks)} of its weight from ${sideName(g1.weakest.deg)} and ${pctOr(roseAt(g1, 90))} from the side.${l11 === 'held' && l12 === 'broken' ? ` So line 1.1 (10%) holds and line 1.2 (25%) breaks: the one robot here whose verdict changes between two neighbouring lines.` : ''}</li>`);
  }
  const fell = robots.filter((r) => r.rose.every((p) => p.breaks === 0));
  if (fell.length) {
    const stayed = fell.filter((r) => r.lines.find((l) => l.id === '2.1')?.status === 'held');
    out.push(`<li><b>${fell.map((r) => r.name).join(' and ')} cannot stand on stock servos.</b> ${fell.length > 1 ? 'Both fall' : 'It falls'} in the warm-up, so every push line breaks with a push of 0%.${stayed.length ? ` ${stayed.map((r) => r.name).join(' and ')} still holds line 2.1, because it falls where it stood: its base never moves 5 cm across the floor. A line checks what it says and nothing else.` : ''}</li>`);
  }
  return out.join('\n');
}

/** The search and the rose side by side, and the independent Python measurement, from apps/yard/crosscheck.txt. */
export function crosscheckSection(robots: YardRow[]): string {
  const rows: string[][] = [];
  for (const r of robots) {
    const ce = r.lines.find((l) => l.id === '1.4')?.counterexample;
    if (!ce || !r.weakest || r.weakest.breaks === 0) continue;
    rows.push([esc(r.name), `${pct(ce.weight)} at ${Math.round(ce.deg)}°`, `${pct(r.weakest.breaks)} at ${r.weakest.deg}°`]);
  }
  let py = '';
  try {
    const txt = readRepoText('apps/yard/crosscheck.txt');
    const lines = [...txt.matchAll(/^(\w+)\s+(\d+) deg\s+(\S+)\s+(\S+)\s*$/gm)];
    const num = (s: string): number | null => (s === 'holds' ? null : Number(s.replace('%', '')) / 100);
    const pairs = lines.map((m) => ({ id: m[1] as string, deg: Number(m[2]), py: num(m[3] as string), golem: num(m[4] as string) }));
    const both = pairs.filter((p) => p.py !== null && p.golem !== null && (p.golem as number) > 0);
    const agreeHolds = pairs.filter((p) => p.py === null && p.golem === null).length;
    const diffs = both.map((p) => Math.abs((p.py as number) - (p.golem as number)));
    const worst = both[diffs.indexOf(Math.max(...diffs))];
    const header = /^MuJoCo (\S+)/m.exec(txt)?.[1] ?? '?';
    if (both.length) {
      py = `<p><b>An independent re-measurement.</b> <a href="${REPO_URL}/blob/main/apps/yard/scripts/crosscheck.py"><code>scripts/crosscheck.py</code></a> shares nothing with GOLEM but the scene files: it uses MuJoCo ${esc(header)} through Python instead of GOLEM's WASM build, and its own keyframe loading, push and upright test, written from the requirements' glossary. At the front, left, back and right of every robot it finds the same breaking push within ${pct(Math.max(...diffs))} of the weight (${both.length} directions where both topple the robot; largest gap ${worst ? `${esc(worst.id)} at ${worst.deg}°` : ''})${agreeHolds ? `, and agrees on the ${agreeHolds} directions that hold 100%` : ''}. Output: <a href="${REPO_URL}/blob/main/apps/yard/crosscheck.txt"><code>crosscheck.txt</code></a>.</p>`;
    }
  } catch { /* the file is optional */ }
  return `<h3 id="search-vs-rose">The search is not the rose</h3>
<p>The falsifier's job is to find one push that breaks a line, then shrink it. The rose maps the weakest push in every direction. They answer different questions, and the table shows it${(() => {
    const g = robots.find((r) => r.id === 'g1'), a = robots.find((r) => r.id === 'anymal_c');
    const ce = (r: YardRow | undefined) => r?.lines.find((l) => l.id === '1.4')?.counterexample;
    const parts: string[] = [];
    if (g?.weakest && ce(g)) parts.push(`for the G1 the shrunk counterexample (${pct(ce(g)!.weight)} at ${Math.round(ce(g)!.deg)}°) lands next to the weakest direction (${pct(g.weakest.breaks)} at ${g.weakest.deg}°)`);
    if (a?.weakest && ce(a)) parts.push(`for ANYmal C the search broke line 1.4 at ${pct(ce(a)!.weight)} from ${sideName(ce(a)!.deg)}, while ${pct(a.weakest.breaks)} from ${sideName(a.weakest.deg)} already topples it`);
    return parts.length ? `: ${parts.join('; ')}` : '';
  })()}. A broken line tells you the requirement is wrong for this robot. It does not tell you the robot's weakest side; that takes a sweep.</p>
${table(['Robot', 'Counterexample to 1.4 (search seed 1)', 'Weakest push on the rose'], rows, { caption: 'Directions counterclockwise from the robot’s front: 0° the front, 90° its left.' })}
${py}`;
}

function verdictCell(l: YardLine | undefined): string {
  if (!l) return '–';
  if (l.status === 'held') return '<span class="held">held</span>';
  if (l.status === 'broken') {
    const ce = l.counterexample;
    if (ce && ce.weight === 0) return '<span class="broken">broken</span><span class="small muted"> with no push</span>';
    return `<span class="broken">broken</span>${ce ? `<span class="small muted"> at ${pct(ce.weight)}, ${Math.round(ce.deg)}°</span>` : ''}`;
  }
  return esc(l.status);
}

export function yardPage(): PageSpec {
  const b = readRepoJson<YardBoard>('apps/yard/board.json');
  const req = readRepoText('apps/yard/.kiro/specs/stand-push/requirements.md');
  const lines = [...req.matchAll(/^(\d)\. (WHEN .+)$/gm)].map((m, i) => [`${i < 4 ? '1' : '2'}.${m[1]}`, m[2] as string]);
  const robots = b.robots;
  const standing = robots.filter((r) => r.rose.some((p) => p.breaks !== 0));
  const fallen = robots.filter((r) => r.rose.every((p) => p.breaks === 0));
  const quads = robots.filter((r) => r.kind === 'quadruped');
  const quadWeak = quads.map((r) => r.weakest?.breaks ?? 1);
  const totalS = robots.reduce((s, r) => s + r.seconds.verdicts + r.seconds.rose, 0);
  const trials = robots.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.trials, 0), 0);

  const boardRows = robots.map((r) => [
    `<a href="#rose-${esc(r.id)}">${esc(r.name)}</a>`,
    ...['1.1', '1.2', '1.3', '1.4', '2.1'].map((id) => verdictCell(r.lines.find((l) => l.id === id))),
    r.rose.every((p) => p.breaks === 0) ? '<span class="broken">falls unpushed</span>' : r.weakest ? `${pct(r.weakest.breaks)} from ${esc(sideName(r.weakest.deg))}` : 'none up to 100%',
  ]);

  const roses = robots.map((r) => `<figure class="rose-card" id="rose-${esc(r.id)}">
${roseSvg(r)}
<figcaption><b>${esc(r.name)}</b> <span class="muted">${esc(r.kind)}</span><br>${r.rose.every((p) => p.breaks === 0)
    ? 'Falls in the warm-up with no push: its stock servos do not hold its keyframe pose.'
    : r.weakest ? `Topples at ${pct(r.weakest.breaks)} of its weight from ${esc(sideName(r.weakest.deg))}${r.strongestBreak !== null ? `; ${r.rose.some((p) => p.breaks === null) ? 'holds 100% from some directions' : `needs up to ${pct(r.strongestBreak)} from its strongest side`}` : ''}.` : 'Holds 100% of its weight from every direction measured.'} <a href="/yard/${esc(r.id)}/">Open its studio</a>.</figcaption>
</figure>`).join('\n');

  const body = `<h1>The yard</h1>
<p class="lede">One requirements file, seven robots. GOLEM fetched seven models from <a href="https://github.com/google-deepmind/mujoco_menagerie">MuJoCo Menagerie</a> at one pinned commit, stood each in its keyframe pose on its own position servos, and ran the same five EARS lines against all of them. ${standing.length} stand; ${fallen.length} fall over before anyone pushes them.</p>
<p>No robot here runs its real controller. The servos hold the pose at the gains the model ships with, and nothing balances. So this board compares the stances that come in the box, not the robots. Its point is the method: the push lines are written as a share of the robot's weight, so the same sentence asks the same thing of a 12 kg dog and a 50 kg one, and adding a robot is one row in a JSON file.</p>

<div class="stats">
<div class="stat"><b>${robots.length}</b><span>Menagerie robots, one requirements file, no per-robot code.</span></div>
<div class="stat"><b class="break">${Math.min(...quadWeak) === Math.max(...quadWeak) ? pct(Math.min(...quadWeak)) : `${pct(Math.min(...quadWeak))} to ${pct(Math.max(...quadWeak))}`}</b><span>Weakest push that topples each of the ${quads.length} quadrupeds, as a share of its weight.</span></div>
<div class="stat"><b>${trials.toLocaleString('en-US')}</b><span>Falsifier trials behind the verdicts, plus the bisection behind the roses; ${Math.round(totalS / 60)} min on one laptop.</span></div>
</div>

<h2 id="board">The board</h2>
<p>Each cell is <code>golem test --budget ${b.budget} --search-seed ${b.searchSeed}</code> on that robot's folder. A broken cell shows the counterexample the search found (shrunk toward the smallest push it could), as a share of the weight and the side it came from (0° the front, 90° the left).</p>
<div class="wide">${table(['Robot', '1.1 (10%)', '1.2 (25%)', '1.3 (50%)', '1.4 (100%)', '2.1 (stays within 5 cm)', 'Weakest push that topples it'], boardRows, { caption: `Raw: apps/yard/board.json. Menagerie commit ${b.commit.slice(0, 7)}.`, cls: 'board' })}</div>

<h2 id="roses">Stance roses</h2>
<p>For each robot, the smallest push that topples it from each of ${b.directions} directions, found by bisection (${b.bisectSteps} halvings, about 0.2% of the weight) with GOLEM's own trial runner on line 1.4. Up is the robot's front, as seen from above. The rings are the four push lines of requirement 1: where the rose dips inside a ring, that line breaks from that side. A dot on the outer ring held 100% of the weight.</p>
<div class="roses wide">
${roses}
</div>

<h2 id="what-it-shows">What it shows</h2>
<ul>
${findings(robots)}
</ul>
${crosscheckSection(robots)}

<h2 id="spec">The requirements</h2>
<p>The whole file is in <a href="${REPO_URL}/blob/main/${b.requirements}"><code>${esc(b.requirements)}</code></a>. These are its five lines, compiled once per robot:</p>
<ol class="ears-list">${lines.map(([id, l]) => `<li><span class="mono muted">${esc(id)}</span> ${earsHtml(l as string)}</li>`).join('')}</ol>

<h2 id="add-a-robot">Add a robot</h2>
<p>Any Menagerie model with position servos and a free base works the same way. Add one row to <a href="${REPO_URL}/blob/main/apps/yard/robots.json"><code>apps/yard/robots.json</code></a> (its folder, model file, keyframe and base body), copy a folder under <code>apps/yard/robots/</code>, then:</p>
${codeBlock('node apps/yard/scripts/fetch-assets.mjs <id>\nnpx golem-spec test --app apps/yard/robots/<id>\nnpx vite-node apps/yard/scripts/board.ts <id>', 'adding a robot to the yard')}
<p class="small muted">The first command downloads the model's files at the pinned commit and records their SHA-256, the second runs the five lines on it, and the third adds its row and rose to this page.</p>
<p>The stand app is one file, <a href="${REPO_URL}/blob/main/apps/yard/stand.ts"><code>apps/yard/stand.ts</code></a>: it reads the keyframe, writes the servo targets, pushes the base and reports three signals. A robot whose actuators are torque motors (the Go2, the H1) needs a PD law first, which the yard does not have yet.</p>`;

  return {
    id: 'yard', path: '/yard/', title: 'The yard: one spec, seven robots',
    description: `The same five EARS requirements on ${robots.length} MuJoCo Menagerie robots, with a stance rose for each.`,
    body,
  };
}

/** /yard/<id>/: the studio on one yard robot, with links to the other six. */
export function yardStudioPage(id: string): PageSpec {
  const b = readRepoJson<YardBoard>('apps/yard/board.json');
  const row = b.robots.find((r) => r.id === id);
  const robots = (readRepoJson<{ robots: { id: string; name: string }[] }>('apps/yard/robots.json')).robots;
  const name = robots.find((r) => r.id === id)?.name ?? id;
  const others = `<nav class="yard-switch" aria-label="Yard robots">${robots.map((r) => `<a href="/yard/${esc(r.id)}/"${r.id === id ? ' aria-current="page"' : ''}>${esc(r.name)}</a>`).join('')}</nav>`;
  const verdict = row?.rose.every((p) => p.breaks === 0)
    ? 'On the board it falls during the warm-up, before any push.'
    : row?.weakest ? `On the board the smallest push that topples it is ${pct(row.weakest.breaks)} of its weight from ${sideName(row.weakest.deg)}.` : '';
  return {
    id: `yard-${id}`, path: `/yard/${id}/`, title: `${name} in the yard`,
    description: `${name} (MuJoCo Menagerie) standing on its stock servos, tested against the yard's shared requirements.`,
    body: `<h1 class="sr-only">${esc(name)} in the yard</h1><div class="flush studio-page"><div class="hero-studio" id="studio" data-studio="yard" data-robot="${esc(id)}" data-status="Waking the golem…"><noscript><p class="hero-fallback">The studio needs JavaScript. The board does not: <a href="/yard/">open the yard</a>.</p></noscript></div><p class="studio-note">${esc(name)} stands in its keyframe pose on its own servos, with no balance controller. ${verdict} Summon ghosts on a line, or drag the base to shove it. <a href="/yard/">Back to the board</a>.</p>${others}</div>`,
    modules: ['/src/studio/load.ts'],
    mainClass: 'studio-main',
  };
}
