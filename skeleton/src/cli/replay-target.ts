// Which scenario and seed `golem replay` and the MCP `replay` tool run.
import type { Counterexample, Scenario } from './sibling-types.js';

export type ReplayTarget =
  | { ok: true; source: 'pinned' | 'closest'; scenario: Scenario; seed: number }
  | { ok: false; reason: 'none-pinned' | 'seed-not-pinned'; pinnedSeeds: number[] };

export function selectReplay(
  pinned: readonly Counterexample[],
  closest: { scenario: Scenario; seed: number } | undefined,
  o: { cli: boolean; seed?: number },
): ReplayTarget {
  const pinnedSeeds = pinned.map((p) => p.seed);
  const last = pinned.length > 0 ? (pinned[pinned.length - 1] as Counterexample) : undefined;
  if (o.cli) {
    if (o.seed === undefined) {
      return last === undefined
        ? { ok: false, reason: 'none-pinned', pinnedSeeds }
        : { ok: true, source: 'pinned', scenario: last.scenario, seed: last.seed };
    }
    if (last !== undefined) return { ok: true, source: 'pinned', scenario: last.scenario, seed: o.seed };
    if (closest !== undefined) return { ok: true, source: 'closest', scenario: closest.scenario, seed: o.seed };
    return { ok: false, reason: 'none-pinned', pinnedSeeds };
  }
  if (last === undefined) return { ok: false, reason: 'none-pinned', pinnedSeeds };
  if (o.seed === undefined) return { ok: true, source: 'pinned', scenario: last.scenario, seed: last.seed };
  for (let i = pinned.length - 1; i >= 0; i--) {
    const p = pinned[i] as Counterexample;
    if (p.seed === o.seed) return { ok: true, source: 'pinned', scenario: p.scenario, seed: p.seed };
  }
  return { ok: false, reason: 'seed-not-pinned', pinnedSeeds };
}
