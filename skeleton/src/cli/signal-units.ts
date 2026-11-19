// Units of signals and the unit of a verdict (assumption A5).
import type { RobotApp } from './sibling-types.js';
import type { ReportVerdict } from './types.js';
import type { Verdict } from './sibling-types.js';

export const UNIT_MISSING = 'unit not declared';

/** `RobotApp.signalUnits`, then the unit of a lexicon predicate that reads the signal, then the text `unit not declared`. */
export function signalUnit(app: Pick<RobotApp, 'lexicon'> & { signalUnits?: Record<string, string> }, signal: string): string {
  const declared = app.signalUnits?.[signal];
  if (declared !== undefined) return declared;
  const p = app.lexicon.predicates.find((x) => x.signals.includes(signal));
  return p?.unit ?? UNIT_MISSING;
}

/** Collects `TrialResult.unit` through the falsify `onResult` callback, per requirement id. */
export function createUnitCapture(): { onResult(r: { unit: string; spec: { reqId: string } }): void; unitOf(reqId: string): string | undefined } {
  const units = new Map<string, string>();
  return {
    onResult(r) { if (typeof r.unit === 'string' && r.unit !== '') units.set(r.spec.reqId, r.unit); },
    unitOf: (id) => units.get(id),
  };
}

/** A verdict as stored in the report: the additive `unit` and `ears` fields. */
export function reportVerdict(v: Verdict, unit: string | undefined, ears?: string): ReportVerdict {
  return { ...v, ...(unit !== undefined ? { unit } : {}), ...(ears !== undefined ? { ears } : {}) };
}
