// Tiny_Test_App: a RobotApp with no MuJoCo and an analytic synthetic trial (design, "Data Models").
//   height(t) = 1.0 - 0.004 * F * s(t) - noise,  tilt(t) = 0.002 * F * s(t),  s(t) = min(1, t / 0.5)
// with t counted from the trigger. For `keep its height above 0.4 m` the robustness is about
// 0.6 - 0.004 * F - noise, so the requirement breaks above roughly 150 N.
import type { Lexicon, PerturbationTemplate, PredicateTemplate } from '../../src/ears/index.js';
import { compileRequirementsFile } from '../../src/ears/index.js';
import { mulberry32 } from '../../src/sim/prng.js';
import type { CompiledRequirement, RobotApp, Trace, TrialResult, TrialSpec } from '../../src/cli/sibling-types.js';

export const TINY_WARMUP = 0.2;
export const TINY_CONTROL_DT = 0.02;
export const TINY_HORIZON_S = 1;
export const TINY_NOISE_M = 0.01;

const rangeMax = (slot: unknown): number => {
  if (Array.isArray(slot)) return (slot[1] as { si: number }).si;
  if (slot !== null && typeof slot === 'object') return (slot as { si: number }).si;
  return 100;
};

const push: PerturbationTemplate = {
  phrase: 'the base is pushed with {range:force}',
  dims: (slots) => [{
    name: 'push.force', kind: 'force', min: 0, max: rangeMax(slots['force'] ?? slots['range']), severity: 'up',
  }],
  apply: () => undefined,
  visual: (values) => ({ force: [values['push.force'] ?? 0, 0, 0], at: 'base' }),
};

const height: PredicateTemplate = {
  phrase: 'keep its height above {length}',
  signals: ['height'],
  margin: (s, slots) => (s['height'] as number) - (slots['length'] as number),
  unit: 'm',
};

const tilt: PredicateTemplate = {
  phrase: 'keep its tilt below {angle}',
  signals: ['tilt'],
  margin: (s, slots) => (slots['angle'] as number) - (s['tilt'] as number),
  unit: 'rad',
};

export const tinyLexicon: Lexicon = { robotNames: ['robot'], predicates: [height, tilt], perturbations: [push] };

export const tinyApp: RobotApp = {
  id: 'tiny',
  name: 'Tiny test app',
  files: async () => ({}),
  sceneFile: 'scene.xml',
  simDt: 0.002,
  controlDt: TINY_CONTROL_DT,
  warmup: TINY_WARMUP,
  lexicon: tinyLexicon,
  makeController: () => ({ step: () => undefined }),
  signals: () => undefined,
  signalUnits: { height: 'm', tilt: 'rad' },
};

/** A requirement file of three lines: two hold or break by force, one is unreachable. */
export const TINY_REQUIREMENTS = `# Requirements Document

### Requirement 1: Height

#### Acceptance Criteria

1. WHEN the base is pushed with up to 100 N THE robot SHALL keep its height above 0.4 m for 1 s
2. WHEN the base is pushed with up to 200 N THE robot SHALL keep its height above 0.4 m for 1 s
3. WHEN the base is pushed with up to 100 N THE robot SHALL keep its tilt below 0.5 rad for 1 s
`;

/** Compiles a requirements text with the Tiny lexicon; throws on an error diagnostic. */
export function compileTiny(text: string = TINY_REQUIREMENTS): CompiledRequirement[] {
  const r = compileRequirementsFile(text, tinyLexicon);
  const bad = r.diagnostics.filter((d) => d.severity === 'error');
  if (bad.length > 0) throw new Error(`tiny requirements do not compile: ${bad.map((d) => d.message).join('; ')}`);
  return r.requirements as CompiledRequirement[];
}

/** Builds the synthetic trace of one trial. */
export function tinyTrace(spec: TrialSpec, horizon: number = TINY_HORIZON_S): Trace {
  const force = spec.scenario['push.force'] ?? 0;
  const noise = TINY_NOISE_M * mulberry32(spec.seed)();
  const n = Math.round(horizon / TINY_CONTROL_DT) + 1;
  const t = new Float64Array(n);
  const h = new Float64Array(n);
  const a = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const tt = k * TINY_CONTROL_DT;
    const s = Math.min(1, tt / 0.5);
    t[k] = TINY_WARMUP + tt;
    h[k] = 1.0 - 0.004 * force * s - noise;
    a[k] = 0.002 * force * s;
  }
  return { t, signals: { height: h, tilt: a }, events: [{ name: 'trigger', t: TINY_WARMUP }] };
}

export function tinyTrial(req: CompiledRequirement, spec: TrialSpec): { result: TrialResult; trace: Trace } {
  const trace = tinyTrace(spec, req.horizon);
  const m = req.monitor(trace);
  return { result: { spec, robustness: m.robustness, worstAt: m.worstAt, unit: m.unit, wallMs: 0 }, trace };
}
