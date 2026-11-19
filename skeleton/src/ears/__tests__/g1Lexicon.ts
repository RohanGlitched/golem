// A realistic Unitree G1 lexicon in the shape apps/stagger uses, for regression, corpus and
// metamorphic tests. Margins are simple closed forms over named signals; apply() is a no-op.
import type { Lexicon, PerturbationTemplate, PredicateTemplate } from '../types.js';

export const PUSH_PHRASE = 'the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}';
export const SLOPE_PHRASE = 'walking on a slope of {range:angle}';
export const PAYLOAD_PHRASE = 'carrying a payload of {range:mass}';

/** One gait period of the G1 walking policy, in seconds: the latest a phase-timed push can start. */
export const G1_STRIDE = 0.8;

export const push: PerturbationTemplate = {
  phrase: PUSH_PHRASE,
  slots: {
    force: { dim: 'push.force', severity: 'up' },
    direction: { dim: 'push.angle', severity: 'none' },
    phase: { dim: 'push.phase', severity: 'none' },
  },
  apply: () => {},
};

export const slope: PerturbationTemplate = {
  phrase: SLOPE_PHRASE,
  slots: { angle: { dim: 'slope.angle', severity: 'up' } },
  apply: () => {},
};

export const payload: PerturbationTemplate = {
  phrase: PAYLOAD_PHRASE,
  slots: { mass: { dim: 'payload.mass', severity: 'up' } },
  apply: () => {},
};

export const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['pelvis_z', 'tilt_deg'], unit: 'm',
  margin: (s) => Math.min(s['pelvis_z']! - 0.5, (60 - s['tilt_deg']!) / 100),
};

export const pelvisAbove: PredicateTemplate = {
  phrase: 'keep its pelvis above {length}', signals: ['pelvis_z'], unit: 'm',
  margin: (s, k) => s['pelvis_z']! - k['length']!,
};

export const trackSpeed: PredicateTemplate = {
  phrase: 'track the commanded speed within {speed}', signals: ['forward_speed', 'commanded_speed'], unit: 'm/s',
  margin: (s, k) => k['speed']! - Math.abs(s['forward_speed']! - s['commanded_speed']!),
};

export function g1Lexicon(extra: Partial<Lexicon> = {}): Lexicon {
  return {
    robotNames: ['golem', 'G1', 'robot', 'Unitree G1'],
    predicates: [upright, pelvisAbove, trackSpeed],
    perturbations: [push, slope, payload],
    ...extra,
  };
}

/** A legacy lexicon: the same push, written with the deprecated dims() the way the audit probe does. */
export function legacyLexicon(): Lexicon {
  const DIRS: Record<string, [number, number]> = { 'any direction': [0, 2 * Math.PI], behind: [3 * Math.PI / 4, 5 * Math.PI / 4] };
  return {
    robotNames: ['golem'],
    predicates: [upright],
    perturbations: [{
      phrase: PUSH_PHRASE,
      dims: (sl) => {
        const f = sl['force'] as [{ si: number }, { si: number }];
        const dir = sl['direction'];
        const d = typeof dir === 'string' ? DIRS[dir]! : [(dir as { si: number }).si, (dir as { si: number }).si];
        return [
          { name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' },
          { name: 'push.angle', kind: 'angle', min: d[0]!, max: d[1]!, severity: 'none', wrap: true },
          { name: 'push.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
        ];
      },
      apply: () => {},
    }],
  };
}
