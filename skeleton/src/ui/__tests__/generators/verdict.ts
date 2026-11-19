import fc from 'fast-check';
import type { Counterexample, Dimension, Kind, ShareState, Verdict } from '../../types.js';

export const KINDS: Kind[] = ['force', 'duration', 'length', 'speed', 'angle', 'mass', 'ratio', 'count', 'phase'];

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
export const arbDimName = fc.stringMatching(/^[a-z]{1,6}(\.[a-z]{1,6})?$/);

export const arbScenario = fc.dictionary(arbDimName, finite, { maxKeys: 5 });

export const arbDimension: fc.Arbitrary<Dimension> = fc.record({
  name: arbDimName,
  kind: fc.constantFrom(...KINDS),
  min: fc.double({ min: 0, max: 10, noNaN: true }),
  max: fc.double({ min: 10, max: 400, noNaN: true }),
  severity: fc.constantFrom('up' as const, 'down' as const, 'none' as const),
  wrap: fc.option(fc.boolean(), { nil: undefined }),
}).map((d) => {
  const { wrap, ...rest } = d;
  return wrap === undefined ? rest : { ...rest, wrap };
});

export const arbRobust = fc.oneof(finite, fc.constantFrom(-Infinity, 0, -0));

export const arbCounterexample: fc.Arbitrary<Counterexample> = fc.record({
  reqId: fc.stringMatching(/^(R?\d{1,2}(\.\d{1,2})?)$/),
  scenario: arbScenario,
  seed: fc.integer({ min: -(2 ** 31), max: 2 ** 32 }),
  robustness: arbRobust,
  shrunk: fc.boolean(),
  foundAfter: fc.nat({ max: 100000 }),
});

export const arbVerdict: fc.Arbitrary<Verdict> = fc.record({
  reqId: fc.constantFrom('1.1', '2.3', 'R4'),
  status: fc.constantFrom('held' as const, 'broken' as const, 'error' as const),
  randomTrials: fc.nat({ max: 5000 }),
  guidedTrials: fc.nat({ max: 5000 }),
  extra: fc.nat({ max: 50 }),
  closest: fc.record({ robustness: arbRobust, scenario: arbScenario, seed: fc.nat() }),
  counterexample: fc.option(arbCounterexample, { nil: undefined }),
  failureRateUpper95: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  ms: fc.nat({ max: 10_000_000 }),
}).map(({ extra, counterexample, failureRateUpper95, ...v }) => ({
  ...v,
  trials: v.randomTrials + v.guidedTrials + extra,
  ...(counterexample ? { counterexample } : {}),
  ...(failureRateUpper95 !== undefined ? { failureRateUpper95 } : {}),
}));

export const arbLineId = fc.stringMatching(/^\d{1,2}\.\d{1,2}$/);

export const arbShareState: fc.Arbitrary<ShareState> = fc.record({
  lines: fc.dictionary(arbLineId, fc.string({ unit: 'grapheme', maxLength: 60 }), { maxKeys: 6 }),
  pick: fc.option(fc.record({ reqId: arbLineId, seed: fc.integer({ min: -(2 ** 31), max: 2 ** 32 }), scenario: arbScenario }), { nil: undefined }),
}).map(({ lines, pick }) => (pick ? { lines, pick } : { lines }));
