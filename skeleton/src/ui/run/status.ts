// Line status, margin text and counterexample summaries. Pure.
import { formatSig } from '../core/format.js';
import { siToDisplayByKind } from '../core/units-ui.js';
import type { Kind, Lexicon, LineStatus, Scenario, ScenarioSpace, Verdict } from '../types.js';

export function statusOfVerdict(v: Pick<Verdict, 'status'>): LineStatus {
  return v.status === 'broken' ? 'broken' : v.status === 'held' ? 'held' : 'error';
}

export function lineStatusOf(s: { hasCompileError: boolean; running: boolean; verdict?: Pick<Verdict, 'status'> }): LineStatus {
  if (s.hasCompileError) return 'error';
  if (s.running) return 'running';
  if (s.verdict) return statusOfVerdict(s.verdict);
  return 'untested';
}

export function marginText(robustness: number, unit: string): string {
  // -Infinity, and the sim's sentinel for a trial that diverged numerically (-Number.MAX_VALUE).
  if (robustness <= -Number.MAX_VALUE) return 'diverged';
  if (Number.isNaN(robustness)) return 'not measured';
  return unit ? `${formatSig(robustness, 3)} ${unit}` : formatSig(robustness, 3);
}

export const DEFAULT_PHRASES: Record<Kind, string> = {
  force: 'from {v} N',
  angle: 'at {v} deg',
  phase: '{v}% into the stride',
  duration: 'for {v} s',
  length: 'at {v} m',
  speed: 'at {v} m/s',
  mass: 'carrying {v} kg',
  ratio: '{v}%',
  count: '{v} times',
};

/** Phrases that read as a separate clause get a comma before them. */
const COMMA_KINDS: ReadonlySet<Kind> = new Set<Kind>(['phase', 'ratio']);

const FALL_SIGNAL = /^(pelvis|torso|base|com)_?(height|z|tilt|pitch|roll|upright)/;
const FALL_UNITS: ReadonlySet<string> = new Set(['m', 'rad', 'deg']);

/** The lexicon predicates whose literal words (before the first slot) appear in the source line. */
export function predicatesOf(source: string, lexicon: Pick<Lexicon, 'predicates'>): Lexicon['predicates'] {
  const low = source.toLowerCase();
  return lexicon.predicates.filter((p) => {
    const lit = p.phrase.split('{')[0]!.trim().toLowerCase();
    return lit.length > 0 && low.includes(lit);
  });
}

/** True when a failing predicate measures a fall: a height or tilt signal in m, rad or deg. */
export function isFall(predicates: Lexicon['predicates']): boolean {
  return predicates.some((p) => FALL_UNITS.has(p.unit) && p.signals.some((s) => FALL_SIGNAL.test(s.replace(/\./g, '_'))));
}

export const replayLabel = (fall: boolean): string => (fall ? 'Replay the fall' : 'Replay the failure');

export function counterexampleSummary(
  space: ScenarioSpace, scenario: Scenario, classification?: 'robust' | 'seed-sensitive',
  phrases?: Partial<Record<Kind, string>>, fall = false,
): string {
  let out = fall ? 'falls' : 'fails';
  for (const d of space.dims) {
    if (d.severity === 'none' && !d.wrap) continue;
    const si = scenario[d.name];
    if (typeof si !== 'number') continue;
    const v = formatSig(siToDisplayByKind(d.kind, si), 3);
    const tpl = phrases?.[d.kind] ?? DEFAULT_PHRASES[d.kind];
    out += (COMMA_KINDS.has(d.kind) ? ', ' : ' ') + tpl.replace('{v}', v);
  }
  if (classification === 'seed-sensitive') out += ', depends on the seed';
  return out;
}

/** The status line text shown under a requirement. Never says "proved" or "verified". */
export function statusText(s: {
  status: LineStatus; trials?: number; verdict?: Verdict; unit?: string; summary?: string; error?: string;
}): string {
  switch (s.status) {
    case 'untested': return 'Not tested yet';
    case 'running': return `Running: ${s.trials ?? 0} trials`;
    case 'held': {
      const v = s.verdict;
      const n = v?.trials ?? 0;
      const m = v ? `, closest call ${marginText(v.closest.robustness, s.unit ?? '')}` : '';
      return `Held: no counterexample found in ${n} trials${m}`;
    }
    case 'broken': return `Broken: ${s.summary ?? 'counterexample found'}`;
    case 'error': return `Error: ${s.error ?? 'the run failed'}`;
  }
}
