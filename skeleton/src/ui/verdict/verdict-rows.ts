// Verdict_Panel rows. Pure formatting; never claims a proof.
import { formatSig } from '../core/format.js';
import { marginText } from '../run/status.js';
import type { Budget, Verdict, VerdictRows } from '../types.js';

export function budgetText(b: Budget): string {
  const parts: string[] = [];
  if (b.maxTrials !== undefined) parts.push(`${b.maxTrials} trials`);
  if (b.maxMs !== undefined) parts.push(`${formatSig(b.maxMs / 1000, 3)} s`);
  return parts.length ? parts.join(' or ') : 'no limit';
}

export const failureRateText = (p: number | undefined): string =>
  p === undefined || !Number.isFinite(p) ? 'not available' : `${formatSig(p * 100, 2)}%`;

export const wallTimeText = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function heldSentence(v: Pick<Verdict, 'trials' | 'randomTrials' | 'guidedTrials'>, budget: Budget): string {
  return `No counterexample found in ${v.trials} trials (${v.randomTrials} random, ${v.guidedTrials} guided). Search budget: ${budgetText(budget)}.`;
}

export function verdictRows(v: Verdict, poolSize: number, unit: string, budget: Budget): VerdictRows {
  const rows = [
    { label: 'Trials', value: String(v.trials) },
    { label: 'Random trials', value: String(v.randomTrials) },
    { label: 'Guided trials', value: String(v.guidedTrials) },
    { label: 'Closest call', value: marginText(v.closest.robustness, unit) },
    { label: 'Failure-rate bound (95%)', value: failureRateText(v.failureRateUpper95) },
    { label: 'Wall time', value: wallTimeText(v.ms) },
    { label: 'Pool size', value: String(poolSize) },
  ];
  let sentence: string;
  if (v.status === 'held') sentence = heldSentence(v, budget);
  else if (v.status === 'broken') {
    const after = v.counterexample ? ` after ${v.counterexample.foundAfter} trials` : '';
    sentence = `Counterexample found${after}, in ${v.trials} trials in total.`;
  } else sentence = `The run stopped with an error after ${v.trials} trials.`;
  return { rows, sentence };
}
