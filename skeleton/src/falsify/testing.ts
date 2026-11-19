// Test-only helpers (separate entry). Never imported by engine code.
import fc from 'fast-check';
import type { Dimension, Scenario, ScenarioSpace, TrialPool, TrialResult, TrialSpec } from './contract.js';
import { AbortError } from './errors.js';
import { fmix32, mulberry32 } from './prng.js';
import { shrink, type ShrinkLimits, type ShrinkOutcome } from './shrink.js';

export const arbDimension = (name: string): fc.Arbitrary<Dimension> =>
  fc.oneof(
    // fixed
    fc.record({ min: fc.double({ min: -100, max: 100, noNaN: true }) }).map(
      ({ min }): Dimension => ({ name, kind: 'length', min, max: min, severity: 'none' }),
    ),
    // ranged, optionally wrapping
    fc.record({
      min: fc.double({ min: -100, max: 100, noNaN: true }),
      width: fc.double({ min: 0.01, max: 100, noNaN: true }),
      severity: fc.constantFrom('up' as const, 'down' as const, 'none' as const),
      wrap: fc.boolean(),
    }).map(({ min, width, severity, wrap }): Dimension => ({
      name,
      kind: wrap ? 'angle' : 'force',
      min,
      max: min + width,
      severity,
      ...(wrap ? { wrap: true } : {}),
    })),
  );

/** 1 to 6 dimensions mixing fixed, up, down, none and wrap. */
export const arbSpace: fc.Arbitrary<ScenarioSpace> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbDimension(`d${i}`))))
  .map((dims) => ({ dims }));

// ------------------------------------------------------------------ synthetic robustness functions


export type RobustnessFn = (scenario: Scenario, seed: number) => number;

export type SynthSpec =
  | { kind: 'const'; value: number }
  | { kind: 'halfspace'; dim: string; threshold: number; failAbove: boolean }
  | { kind: 'boxes'; boxes: { bounds: Record<string, [number, number]> }[] }
  | { kind: 'noisy'; base: SynthSpec; amplitude: number };

/** Pure `(scenario, seed) -> robustness`. Negative means the requirement broke. */
export function makeSynthetic(spec: SynthSpec): RobustnessFn {
  switch (spec.kind) {
    case 'const':
      return () => spec.value;
    case 'halfspace':
      return (s) => {
        const v = s[spec.dim] as number;
        return spec.failAbove ? spec.threshold - v : v - spec.threshold;
      };
    case 'boxes':
      return (s) => {
        let r = Infinity;
        for (const box of spec.boxes) {
          let inside = Infinity;
          for (const [dim, [lo, hi]] of Object.entries(box.bounds)) {
            const v = s[dim] as number;
            inside = Math.min(inside, v - lo, hi - v);
          }
          r = Math.min(r, -inside);
        }
        return r;
      };
    case 'noisy': {
      const base = makeSynthetic(spec.base);
      return (s, seed) => base(s, seed) + spec.amplitude * ((fmix32(seed) / 4294967296) * 2 - 1);
    }
  }
}

/** Deterministic standard-normal draw from a trial seed (Box-Muller on two fmix32 outputs). */
export function gaussianNoise(seed: number): number {
  const u1 = (fmix32(seed >>> 0) + 0.5) / 4294967296;
  const u2 = (fmix32((seed ^ 0x5bd1e995) >>> 0) + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function syntheticTrialFn(fn: RobustnessFn, unit = 'm'): (spec: TrialSpec) => TrialResult {
  return (spec) => ({ spec, robustness: fn(spec.scenario, spec.seed), worstAt: 1, unit, wallMs: 0 });
}

const nonFixed = (space: ScenarioSpace): Dimension[] => space.dims.filter((d) => d.min !== d.max);

/** A scenario from fractions in [0, 1): wrap dimensions stay below max. */
export function scenarioFromFractions(space: ScenarioSpace, fracs: readonly number[]): Scenario {
  const s: Scenario = {};
  space.dims.forEach((d, i) => {
    const f = fracs[i % fracs.length] as number;
    let v = d.min + Math.min(f, 1 - 1e-9) * (d.max - d.min);
    if (v > d.max) v = d.max;
    s[d.name] = d.min === d.max ? d.min : v;
  });
  return s;
}

/** Random synthetic function over `space` (may or may not have a failing region). */
export const arbSynthetic = (space: ScenarioSpace): fc.Arbitrary<SynthSpec> => {
  const dims = nonFixed(space);
  if (dims.length === 0) return fc.double({ min: -1, max: 1, noNaN: true }).map((value): SynthSpec => ({ kind: 'const', value }));
  const arbDim = fc.constantFrom(...dims);
  const arbThreshold = (d: Dimension) => fc.double({ min: 0, max: 1, noNaN: true }).map((f) => d.min + f * (d.max - d.min));
  const halfspace = arbDim.chain((d) => fc.tuple(arbThreshold(d), fc.boolean()).map(
    ([threshold, failAbove]): SynthSpec => ({ kind: 'halfspace', dim: d.name, threshold, failAbove }),
  ));
  const box = fc.array(fc.tuple(arbDim, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })), { minLength: 1, maxLength: 3 })
    .map((parts) => {
      const bounds: Record<string, [number, number]> = {};
      for (const [d, a, b] of parts) {
        const lo = d.min + Math.min(a, b) * (d.max - d.min);
        const hi = d.min + Math.max(a, b) * (d.max - d.min);
        bounds[d.name] = [lo, hi];
      }
      return { bounds };
    });
  const boxes = fc.array(box, { minLength: 1, maxLength: 3 }).map((bs): SynthSpec => ({ kind: 'boxes', boxes: bs }));
  const base = fc.oneof(halfspace, boxes);
  return fc.oneof(
    base,
    fc.tuple(base, fc.double({ min: 0, max: 0.05, noNaN: true })).map(([b, amplitude]): SynthSpec => ({ kind: 'noisy', base: b, amplitude })),
  );
};

export interface FailingCase { space: ScenarioSpace; spec: SynthSpec; scenario: Scenario; seed: number }

/** A space, a (possibly non-monotone) function and a scenario that fails under `seed`. */
export const arbFailingCase: fc.Arbitrary<FailingCase> = fc
  .tuple(
    arbSpace,
    fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 }),
    fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    fc.constantFrom('halfspace' as const, 'boxes' as const, 'union' as const),
    fc.array(fc.double({ min: 0.01, max: 0.5, noNaN: true }), { minLength: 6, maxLength: 6 }),
    fc.nat(5),
  )
  .map(([space, fracs, seed, shape, margins, pick]): FailingCase => {
    const scenario = scenarioFromFractions(space, fracs);
    const dims = nonFixed(space);
    if (dims.length === 0) return { space, spec: { kind: 'const', value: -1 }, scenario, seed };
    const d = dims[pick % dims.length] as Dimension;
    const v = scenario[d.name] as number;
    const w = d.max - d.min;
    const around = (): { bounds: Record<string, [number, number]> } => {
      const bounds: Record<string, [number, number]> = {};
      dims.forEach((e, i) => {
        const x = scenario[e.name] as number;
        bounds[e.name] = [x - (margins[i % 6] as number) * (e.max - e.min), x + (margins[(i + 1) % 6] as number) * (e.max - e.min)];
      });
      return { bounds };
    };
    if (shape === 'halfspace') {
      const failAbove = (pick % 2) === 0;
      const delta = (margins[0] as number) * w;
      return { space, spec: { kind: 'halfspace', dim: d.name, threshold: failAbove ? v - delta : v + delta, failAbove }, scenario, seed };
    }
    const own = around();
    if (shape === 'boxes') return { space, spec: { kind: 'boxes', boxes: [own] }, scenario, seed };
    const far: { bounds: Record<string, [number, number]> } = { bounds: { [d.name]: [d.min, d.min + 0.2 * w] } };
    return { space, spec: { kind: 'boxes', boxes: [far, own] }, scenario, seed };
  });

// ------------------------------------------------------------------ direct test pool

export interface DirectPoolOptions {
  /** Shuffles the order in which results are reported to onResult (seeded). */
  shuffleSeed?: number;
  /** Rejects the `call`-th run (0-based) with the returned error. */
  rejectRun?: (call: number, specs: readonly TrialSpec[]) => unknown | undefined;
  size?: number;
}

export interface DirectPool extends TrialPool {
  readonly calls: TrialSpec[][];
  readonly closed: boolean;
}

/**
 * Minimal in-memory TrialPool for falsifier tests. Results come back in input order; `onResult` is
 * called once per result (in shuffled order when requested). Honours an AbortSignal.
 */
export function directPool(trialFn: (spec: TrialSpec) => TrialResult | Promise<TrialResult>, o: DirectPoolOptions = {}): DirectPool {
  let callCount = 0;
  const calls: TrialSpec[][] = [];
  const pool: DirectPool & { closed: boolean } = {
    size: o.size ?? 1,
    calls,
    closed: false,
    async run(specs, onResult, opts) {
      const isAborted = (): boolean => opts?.signal?.aborted === true;
      const call = callCount++;
      calls.push([...specs]);
      if (isAborted()) throw new AbortError();
      const rej = o.rejectRun?.(call, specs);
      if (rej !== undefined) throw rej;
      const results: TrialResult[] = [];
      for (const spec of specs) {
        results.push(await trialFn(spec));
        if (isAborted()) throw new AbortError();
      }
      const order = specs.map((_, i) => i);
      if (o.shuffleSeed !== undefined) {
        const rng = mulberry32(o.shuffleSeed + call);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [order[i], order[j]] = [order[j] as number, order[i] as number];
        }
      }
      for (const i of order) {
        if (isAborted()) throw new AbortError();
        await onResult?.(results[i] as TrialResult);
      }
      return results;
    },
    async close() { pool.closed = true; },
  };
  return pool;
}
export async function shrinkCase(c: FailingCase, limits: ShrinkLimits, log?: Scenario[]): Promise<ShrinkOutcome> {
  const fn = makeSynthetic(c.spec);
  const initial = fn(c.scenario, c.seed);
  return shrink({ scenario: c.scenario, seed: c.seed, robustness: initial }, c.space, (s) => {
    log?.push(s);
    return Promise.resolve({ robustness: fn(s, c.seed) });
  }, limits);
}

export const arbShrinkLimits: fc.Arbitrary<ShrinkLimits> = fc.record({
  tolerance: fc.double({ min: 0.001, max: 0.5, noNaN: true }),
  maxTrials: fc.integer({ min: 1, max: 80 }),
});

/** Failing cases only: the generated function fails at the generated scenario under the generated seed. */
export const arbFailing: fc.Arbitrary<FailingCase> = arbFailingCase.filter(
  (c) => makeSynthetic(c.spec)(c.scenario, c.seed) < 0,
);