// Verdict_Panel rows. Pure formatting; never claims a proof.
import { heldWording } from '../../falsify/index.js';
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

export function heldSentence(
  v: Pick<Verdict, 'trials' | 'randomTrials' | 'guidedTrials'> & { failureRateUpper95?: number | undefined }, budget: Budget,
): string {
  const rate = v.failureRateUpper95 !== undefined && Number.isFinite(v.failureRateUpper95) ? `${formatSig(v.failureRateUpper95 * 100, 2)} %` : undefined;
  const wording = heldWording(v.trials, v.randomTrials, rate);
  const sentence = `${wording.charAt(0).toUpperCase()}${wording.slice(1)}`;
  const split = rate === undefined ? ` (${v.randomTrials} random, ${v.guidedTrials} guided)` : '';
  return `${sentence}${split}. Search budget: ${budgetText(budget)}.`;
}

export function verdictRows(v: Verdict, poolSize: number, unit: string, budget: Budget): VerdictRows {
  const rows = [
    { label: 'Trials', value: String(v.trials) },
    { label: 'Random trials', value: String(v.randomTrials) },
    { label: 'Guided trials', value: String(v.guidedTrials) },
    { label: v.closest.robustness < 0 ? 'Worst margin (below 0 = broke)' : 'Closest margin', value: marginText(v.closest.robustness, unit) },
    { label: 'Failure-rate bound (95%, random trials)', value: failureRateText(v.failureRateUpper95) },
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
