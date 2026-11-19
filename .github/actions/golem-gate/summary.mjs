// Writes the GOLEM gate job summary (Markdown) from the output of `golem-spec gate --json` and .golem/report.json.
// Used by action.yml; plain Node ES module, no dependencies. `buildSummary` is pure and unit-tested.
//
//   node summary.mjs --gate gate.json --report .golem/report.json --exit-code 2 --app-dir apps/stagger \
//        --budget 24 [--search-seed 7] [--stderr gate.stderr.txt] [--out file]
//
// It appends to $GITHUB_STEP_SUMMARY (or --out), prints to stdout when neither is set, and always exits 0:
// the gate's exit code decides the job, never this script.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNIT_NOT_DECLARED = 'unit not declared';

/** Three significant digits, no trailing zeros (same rule as the CLI's margins). */
export function sig3(x) {
  if (Object.is(x, -0)) return '0';
  const n = Number(x.toPrecision(3));
  const a = Math.abs(n);
  if (n !== 0 && (a < 1e-9 || a >= 1e12)) return n.toExponential(2).replace(/\.?0+e/, 'e');
  return n.toLocaleString('en-US', { maximumFractionDigits: 12, useGrouping: false });
}

/** "-0.318 m", "+0.252 m". */
export function formatMargin(robustness, unit) {
  if (typeof robustness !== 'number' || Number.isNaN(robustness)) return 'margin unavailable';
  const u = unit || UNIT_NOT_DECLARED;
  if (!Number.isFinite(robustness)) return `${robustness < 0 ? '-' : '+'}infinity ${u}`;
  const t = sig3(robustness);
  return `${robustness > 0 && !t.startsWith('-') ? '+' : ''}${t} ${u}`;
}

// The gate JSON carries SI values keyed by dimension name, not their kinds. The unit comes from the last name segment
// (push.force, push.angle, tracker.lag ...); a name that is not listed prints as a bare SI number.
const UNIT_BY_SEGMENT = {
  force: (v) => `${sig3(v)} N`,
  angle: (v) => `${sig3((v * 180) / Math.PI)} deg`,
  duration: (v) => `${sig3(v)} s`,
  lag: (v) => `${sig3(v)} s`,
  entry: (v) => `${sig3(v)} s`,
  mass: (v) => `${sig3(v)} kg`,
  speed: (v) => `${sig3(v)} m/s`,
  height: (v) => `${sig3(v)} m`,
  length: (v) => `${sig3(v)} m`,
  ratio: (v) => `${sig3(v * 100)} %`,
  phase: (v) => `${sig3(v)} of the stride`,
};

/** "push.force = 215 N, push.angle = 220 deg". Keys keep their order in the JSON. */
export function formatScenario(scenario) {
  const keys = Object.keys(scenario ?? {});
  if (keys.length === 0) return 'no varied dimension';
  return keys.map((k) => {
    const v = scenario[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} = ${String(v)}`;
    const seg = k.split('.').pop();
    const f = Object.prototype.hasOwnProperty.call(UNIT_BY_SEGMENT, seg) ? UNIT_BY_SEGMENT[seg] : undefined;
    return `${k} = ${f ? f(v) : sig3(v)}`;
  }).join(', ');
}

/** Makes text safe inside one Markdown table cell. */
export function cell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;');
}

/** A code span for a table cell: a pipe is escaped, and a command with a backtick is not expected. */
function code(text) {
  return `\`${String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')}\``;
}

const golemEnv = (env) => Object.entries(env ?? {}).filter(([k, v]) => /^GOLEM_[A-Z0-9_]+$/.test(k) && v !== undefined && v !== '').sort(([a], [b]) => a.localeCompare(b));

/** The command that reproduces a row, run from the repository root. */
export function reproduceCommand(row, { appDir, budget, searchSeed, env }) {
  const cd = appDir && appDir !== '.' && appDir !== './' ? `cd ${appDir} && ` : '';
  const vars = golemEnv(env).map(([k, v]) => `${k}=${v} `).join('');
  const base = `${vars}npx --no-install golem-spec`;
  if (row.status === 'broken') return `${cd}${base} replay ${row.reqId}`;
  const seed = searchSeed !== undefined && searchSeed !== '' ? ` --search-seed ${searchSeed}` : '';
  const n = row.met || row.expectation !== 'Expected_Break' ? budget : Math.max(200, Number(budget) || 0);
  return `${cd}${base} falsify ${row.reqId} --budget ${n}${seed}`;
}

const tail = (text, n) => String(text ?? '').split(/\r?\n/).filter((l, i, a) => !(l === '' && i === a.length - 1)).slice(-n).join('\n');

/**
 * @param {{ gate: any, report: any, exitCode: number, appDir?: string, budget?: string|number, searchSeed?: string|number,
 *           env?: Record<string,string|undefined>, stderrTail?: string }} input
 * @returns {string} Markdown
 */
export function buildSummary(input) {
  const { gate, report, exitCode } = input;
  const appDir = input.appDir ?? '.';
  const budget = input.budget ?? 24;
  const searchSeed = input.searchSeed === undefined || input.searchSeed === '' ? undefined : input.searchSeed;
  const env = input.env ?? {};
  const out = [];
  const where = appDir === '.' ? '' : ` (\`${appDir}\`)`;
  const envLine = golemEnv(env).map(([k, v]) => `\`${k}=${v}\``).join(', ');

  const verdicts = Array.isArray(gate?.verdicts) ? gate.verdicts : null;
  const expectations = Array.isArray(gate?.expectations) ? gate.expectations : null;
  if (verdicts === null || expectations === null) {
    out.push(`## GOLEM gate${where}: could not run (exit ${exitCode})`, '');
    out.push('The gate printed no result, so no requirement was judged. Common causes: the requirements do not compile (`npx golem-spec check`), the app cannot be found, or `golem-spec` is not installed.', '');
    const t = tail(input.stderrTail, 40);
    if (t !== '') out.push('Last lines of the gate output:', '', '~~~~text', t, '~~~~', '');
    return out.join('\n');
  }

  const reportById = new Map((Array.isArray(report?.verdicts) ? report.verdicts : []).map((v) => [v.reqId, v]));
  const verdictById = new Map(verdicts.map((v) => [v.reqId, v]));
  const rows = expectations.map((e) => {
    const v = verdictById.get(e.reqId) ?? {};
    return { ...e, verdict: v, report: reportById.get(e.reqId) ?? {} };
  });
  const unmet = rows.filter((r) => !r.met);
  const green = exitCode === 0;

  out.push(`## GOLEM gate${where}: ${green ? 'GREEN' : 'RED'} (exit ${exitCode})`, '');
  out.push(green
    ? `Every requirement meets its expectation: ${rows.length} of ${rows.length}.`
    : `${unmet.length} of ${rows.length} requirements do not meet their expectation: ${unmet.map((r) => r.reqId).join(', ') || 'none judged'}.`);
  out.push('');
  out.push(`Budget: ${budget} trials per requirement, pinned seeds included. Search seed: ${searchSeed ?? 'from golem.config.json, else 1'}.${envLine ? ` Environment: ${envLine}.` : ''}`, '');

  out.push('| Requirement | Expectation | Verdict | Meets it | Margin | Counterexample | Reproduce |');
  out.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const v = r.verdict;
    const unit = r.report.unit;
    const ce = v.counterexample;
    const ears = r.report.ears ? `<br>${cell(r.report.ears)}` : '';
    let margin = '-';
    let ceText = '-';
    if (v.status === 'error') {
      ceText = 'the run ended in an error; see the job log';
    } else if (v.status === 'broken') {
      margin = formatMargin(ce?.robustness ?? v.closest?.robustness, unit);
      const sc = ce?.scenario ?? v.closest?.scenario;
      ceText = `${formatScenario(sc)}${ce ? ` (${ce.shrunk ? 'shrunk' : 'not shrunk'}, seed ${ce.seed})` : ''}`;
    } else if (v.status === 'held') {
      margin = `closest ${formatMargin(v.closest?.robustness, unit)}`;
      ceText = `none found in ${v.trials} trials`;
    }
    const meets = r.met ? 'yes' : '**NO**';
    out.push(`| **${cell(r.reqId)}**${ears} | ${cell(r.expectation)} | ${cell(r.status ?? v.status ?? 'unknown')} | ${meets} | ${cell(margin)} | ${cell(ceText)} | ${code(reproduceCommand({ ...r, status: r.status ?? v.status }, { appDir, budget, searchSeed, env }))} |`);
  }
  out.push('');
  out.push('A held requirement means no counterexample was found within this budget. It is not a proof.');
  out.push('The report (`.golem/report.json`) and any replays are attached to the run as the `golem-gate` artifact.', '');
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

function readJson(path) {
  if (path === undefined || !existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (text === '') return null;
    // The gate prints one JSON line on stdout; take the last line that parses so a stray log line cannot hide it.
    for (const l of text.split(/\r?\n/).reverse()) {
      try { return JSON.parse(l); } catch { /* try the previous line */ }
    }
    return JSON.parse(text);
  } catch { return null; }
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { o[a.slice(2)] = argv[i + 1] ?? ''; i++; }
  }
  return o;
}

export function main(argv, env = process.env) {
  const a = parseArgs(argv);
  try {
    const gate = readJson(a.gate);
    const report = readJson(a.report);
    const stderrTail = a.stderr && existsSync(a.stderr) ? readFileSync(a.stderr, 'utf8') : '';
    const md = buildSummary({
      gate, report, exitCode: Number(a['exit-code'] ?? 1), appDir: a['app-dir'] || '.', budget: a.budget || 24,
      searchSeed: a['search-seed'], env, stderrTail,
    });
    const dest = a.out || env.GITHUB_STEP_SUMMARY;
    if (dest) appendFileSync(dest, `${md}\n`); else process.stdout.write(`${md}\n`);
  } catch (e) {
    process.stderr.write(`golem-gate: could not write the job summary: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
