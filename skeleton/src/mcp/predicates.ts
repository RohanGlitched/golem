// Readers for the approved optional additions of golem-ears: `CompiledRequirement.predicates` and the `margins`
// map of the monitor result. Order of use in explain_margin: `margins` map, then `predicates`, then an error.
import type { CompiledRequirement, MonitorResult, PredicateBinding } from '../cli/sibling-types.js';

export const MARGINS_UNAVAILABLE = 'per-signal margins unavailable: the compiled requirement carries no predicate bindings';

export function bindingsOf(req: Pick<CompiledRequirement, 'predicates'>): PredicateBinding[] | undefined {
  const p = req.predicates;
  return Array.isArray(p) && p.length > 0 ? p : undefined;
}

export function marginsOf(m: Pick<MonitorResult, 'margins'>): Record<string, number> | undefined {
  const x = m.margins;
  return typeof x === 'object' && x !== null && Object.keys(x).length > 0 ? x : undefined;
}
