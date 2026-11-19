// Prints the STL formula a requirement was compiled to, for reports and reviewers.
// t₀ is the trigger time, t_start and t_end the first and last samples of the trace.
import { fmt } from './dimensions.js';
import type { BoundClause, MatcherSlot } from './matcher.js';
import type { PredicateTemplate, TemporalWrapper } from './types.js';

/** The template phrase with each slot replaced by the value as written. */
export function filledPhrase<T extends { phrase: string }>(bound: BoundClause<T>): string {
  const words = bound.template.phrase.trim().split(/\s+/);
  let k = 0;
  const out: string[] = [];
  for (const el of bound.compiled.pattern) {
    const word = words[k++] ?? '';
    if (typeof el === 'string') { out.push(word); continue; }
    const name = (el as MatcherSlot).name;
    const v = bound.slots[name];
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(bound.ranges[name]?.text ?? `${v[0].text}`);
    else if (v !== undefined) out.push(v.text);
    else out.push(word);
  }
  return out.join(' ');
}

const atom = (b: BoundClause<PredicateTemplate>): string => `margin("${filledPhrase(b)}") > 0 ${b.template.unit}`;
const sec = (x: number): string => `${fmt(x)} s`;

export interface FormulaInput {
  timed: boolean;
  response: BoundClause<PredicateTemplate>;
  wrapper: TemporalWrapper;
  onset: number;
  state?: BoundClause<PredicateTemplate>;
  /** Clause text of a perturbation state, applied for the whole episode. */
  appliedState?: string;
  /** Feature text when the WHERE feature is not enabled. */
  disabledFeature?: string;
}

export function formulaOf(f: FormulaInput): string {
  if (f.disabledFeature !== undefined) return `true (feature "${f.disabledFeature}" is not enabled)`;
  const phi = atom(f.response);
  if (f.state) {
    const hold = f.wrapper.kind === 'always' && f.wrapper.duration !== undefined && f.wrapper.duration > 0
      ? `G[t, t+${sec(f.wrapper.duration)}] ${phi}`
      : phi;
    return `G[t_start, t_end] (${atom(f.state)} → ${hold})`;
  }
  const a = f.timed ? 't₀' : 't_start';
  let core: string;
  if (f.wrapper.duration === undefined) core = `G[${a}, t_end] ${phi}`;
  else if (f.wrapper.kind === 'eventually') core = `F[${a}, ${a}+${sec(f.onset + f.wrapper.duration)}] G[·, t_end] ${phi}`;
  else core = `G[${a}, ${a}+${sec(f.onset + f.wrapper.duration)}] ${phi}`;
  return f.appliedState !== undefined ? `${core}, with "${f.appliedState}" applied throughout` : core;
}
