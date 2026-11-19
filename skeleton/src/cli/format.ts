// Output formatting: one line per requirement, gate blocks, the bounded Kiro reason, Diagnostics.
// Voice follows product.md: plain and exact, a unit on every physical number.
import type { Kind } from '../ears/index.js';
import type { ProgressEvent } from '../falsify/index.js';
import type { CompiledRequirement, Scenario, ScenarioSpace } from './sibling-types.js';
import type { FileDiagnostic, RequirementOutcome } from './types.js';

export const UNIT_NOT_DECLARED = 'unit not declared';
export const REASON_MAX = 4000;

/** Three significant digits, no trailing zeros, no exponent for ordinary magnitudes. */
export function sig3(x: number): string {
  if (Object.is(x, -0)) return '0';
  const n = Number(x.toPrecision(3));
  const a = Math.abs(n);
  if (n !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(2).replace(/\.?0+e/, 'e');
  return String(n);
}

/** SI value to text with its unit: 168 -> "168 N", 2.356 rad (angle) -> "135 deg", ratio 0.3 -> "30 %". */
export function formatQuantity(kind: Kind, si: number): string {
  if (!Number.isFinite(si)) return `${String(si)} (not finite)`;
  switch (kind) {
    case 'force': return `${sig3(si)} N`;
    case 'duration': return `${sig3(si)} s`;
    case 'length': return `${sig3(si)} m`;
    case 'speed': return `${sig3(si)} m/s`;
    case 'angle': return `${sig3((si * 180) / Math.PI)} deg`;
    case 'mass': return `${sig3(si)} kg`;
    case 'ratio': return `${sig3(si * 100)} %`;
    case 'count': return sig3(si);
    case 'phase': return `${sig3(si)} (stride phase)`;
  }
}

/** "push.force = 168 N, push.angle = 135 deg", dimensions in space order, then any other key. */
export function formatScenario(space: ScenarioSpace, s: Scenario): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const d of space.dims) {
    if (!Object.prototype.hasOwnProperty.call(s, d.name)) continue;
    seen.add(d.name);
    parts.push(`${d.name} = ${formatQuantity(d.kind, s[d.name] as number)}`);
  }
  for (const k of Object.keys(s)) if (!seen.has(k)) parts.push(`${k} = ${sig3(s[k] as number)}`);
  return parts.length > 0 ? parts.join(', ') : 'no varied dimension';
}

/** "-0.118 m", "+0.031 m". */
export function formatMargin(robustness: number, unit: string | undefined): string {
  if (Number.isNaN(robustness)) return 'margin unavailable';
  const u = unit ?? UNIT_NOT_DECLARED;
  if (!Number.isFinite(robustness)) return `${robustness < 0 ? '-' : '+'}infinity ${u}`;
  const t = sig3(robustness);
  return `${robustness > 0 && !t.startsWith('-') ? '+' : ''}${t} ${u}`;
}

const STATUS_WORD = { held: 'HELD', broken: 'BROKEN', error: 'ERROR' } as const;

function firstError(o: RequirementOutcome): string {
  return o.meta.errors[0]?.message ?? 'the run failed without a message';
}

/** Requirements 4.8, 4.9. */
export function requirementLine(o: RequirementOutcome): string {
  const v = o.verdict;
  const head = `${v.reqId}  ${STATUS_WORD[v.status]}`;
  if (v.status === 'error') return `${head}  ${v.trials} trials  ${firstError(o)}`;
  if (v.status === 'broken') {
    const ce = v.counterexample;
    const margin = formatMargin(ce?.robustness ?? v.closest.robustness, o.unit);
    const scen = ce !== undefined ? formatScenario(o.req.space, ce.scenario) : formatScenario(o.req.space, v.closest.scenario);
    const how = ce !== undefined ? `(${ce.shrunk ? 'shrunk' : 'not shrunk'}, seed ${ce.seed})` : '';
    return `${head}  margin ${margin}  ${v.trials} trials  ${scen}  ${how}`.trimEnd();
  }
  const rate = v.failureRateUpper95 !== undefined ? ` (failure rate below ${sig3(v.failureRateUpper95 * 100)} % at 95 % confidence)` : '';
  return `${head}  closest margin ${formatMargin(v.closest.robustness, o.unit)}  no counterexample found in ${v.trials} trials${rate}`;
}

export function phaseLabel(phase: 0 | 1 | 2 | 3): 'pinned' | 'random' | 'guided' | 'shrink' {
  return (['pinned', 'random', 'guided', 'shrink'] as const)[phase];
}

/** Requirement 5.2: phase, generation from 0, lowest robustness with unit, trials used, trials remaining. */
export function progressLine(
  e: ProgressEvent, label: 'pinned' | 'random' | 'guided' | 'shrink', ctx: { reqId?: string; unit?: string } = {},
): string {
  const rem = e.trialsRemaining === null ? 'no trial limit' : `${e.trialsRemaining} remaining`;
  const id = ctx.reqId !== undefined ? `${ctx.reqId}  ` : '';
  return `${id}${label} generation ${e.generation}: lowest ${formatMargin(e.lowestRobustness, ctx.unit)}, ${e.trialsUsed} trials used, ${rem}`;
}

/** Requirement 7.6: the EARS line, the scenario, the margin and the replay command. */
export function gateBlock(o: RequirementOutcome, earsLine: string): string {
  const id = o.verdict.reqId;
  const lines = [`${id}: ${earsLine}`];
  if (o.verdict.status === 'error') {
    lines.push(`  error: ${firstError(o)}`);
  } else {
    const ce = o.verdict.counterexample;
    const sc = ce?.scenario ?? o.verdict.closest.scenario;
    lines.push(`  scenario: ${formatScenario(o.req.space, sc)}${ce !== undefined ? ` (seed ${ce.seed})` : ''}`);
    lines.push(`  margin: ${formatMargin(ce?.robustness ?? o.verdict.closest.robustness, o.unit)}`);
  }
  lines.push(`  reproduce: golem replay ${id}`);
  return lines.join('\n');
}

/** Joins blocks with one blank line and cuts at a line boundary to at most `max` characters (requirement 8.7). */
export function buildReason(blocks: readonly string[], reportPath: string, max = REASON_MAX): string {
  const joined = blocks.join('\n\n');
  if (joined.length <= max) return joined;
  const footer = `... truncated, see ${reportPath}`;
  if (footer.length > max) return footer.slice(0, max);
  let kept = '';
  let first = true;
  for (const line of joined.split('\n')) {
    const cand = first ? line : `${kept}\n${line}`;
    if (cand.length + 1 + footer.length > max) break;
    kept = cand;
    first = false;
  }
  return first ? footer : `${kept}\n${footer}`;
}

export function sortDiagnostics(d: readonly FileDiagnostic[], fileOrder: readonly string[]): FileDiagnostic[] {
  const rank = (f: string): number => { const i = fileOrder.indexOf(f); return i < 0 ? fileOrder.length : i; };
  return d.map((x, i) => ({ x, i })).sort((a, b) =>
    rank(a.x.file) - rank(b.x.file) || a.x.line - b.x.line || a.x.column - b.x.column || a.i - b.i).map((e) => e.x);
}

export function diagnosticText(d: FileDiagnostic): string {
  const head = `${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`;
  return d.suggestion !== undefined ? `${head}\n  suggestion: ${d.suggestion}` : head;
}

/** Block text for a compile error under `--kiro` (a Red_Gate): the Diagnostics that must be fixed. */
export function diagnosticsReason(d: readonly FileDiagnostic[]): string {
  const errors = d.filter((x) => x.severity === 'error');
  return [`The requirements do not compile, so the gate cannot run. Fix these ${errors.length} error(s) with golem check:`,
    ...errors.map(diagnosticText)].join('\n');
}

export const NOTHING_TO_CHECK = 'The gate has nothing to check: the Config_File names no requirements, or they compile to zero requirements.';

export interface CheckJson {
  ok: boolean;
  requirements: { id: string; source: string; pattern: string }[];
  diagnostics: { file: string; line: number; col: number; severity: string; message: string; suggestion: string | null }[];
}

export function checkJson(reqs: readonly CompiledRequirement[], d: readonly FileDiagnostic[]): CheckJson {
  return {
    ok: !d.some((x) => x.severity === 'error'),
    requirements: reqs.map((r) => ({ id: r.id, source: r.source, pattern: r.pattern })),
    diagnostics: d.map((x) => ({ file: x.file, line: x.line, col: x.column, severity: x.severity, message: x.message, suggestion: x.suggestion ?? null })),
  };
}

/** The stderr message for an allowed stop on a red gate (requirement 8.20). */
export function redAllowMessage(sessionId: string, notHeld: readonly { id: string; ears: string }[]): string {
  const lines = [`golem gate: the gate is still RED after 5 blocks for session ${sessionId}; allowing this stop.`];
  for (const r of notHeld) lines.push(`  ${r.id}: ${r.ears}`);
  return `${lines.join('\n')}\n`;
}
