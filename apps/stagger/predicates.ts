// The four G1 predicates. Each margin is positive when the predicate holds and is measured in the
// predicate's unit, so robustness reads as a physical distance from failure.
import type { PredicateTemplate } from './contract.js';

export const UPRIGHT_HEIGHT = 0.5;      // m
export const UPRIGHT_TILT_LIMIT = 60;   // deg
export const FALLEN_MARGIN = -0.01;     // m
export const SETTLING_TIME = 2;         // s of episode time

/**
 * `stay upright`: the margin is `pelvis_z - 0.5 m`. When the Tilt exceeds 60 deg the margin is forced
 * to -0.01 m whatever the pelvis height. Reason: a robot lying on its side can keep its pelvis above
 * 0.5 m (it can fall onto its arm or a step) while it has clearly fallen. A small fixed negative margin
 * marks that state as broken without reporting a misleading height margin.
 */
export const stayUpright: PredicateTemplate = {
  phrase: 'stay upright',
  signals: ['pelvis_z', 'tilt_deg'],
  unit: 'm',
  margin: (s) => ((s['tilt_deg'] as number) > UPRIGHT_TILT_LIMIT ? FALLEN_MARGIN : (s['pelvis_z'] as number) - UPRIGHT_HEIGHT),
};

/** `keep its pelvis above {length}`: `pelvis_z - length`, in m. */
export const pelvisAbove: PredicateTemplate = {
  phrase: 'keep its pelvis above {length}',
  signals: ['pelvis_z'],
  unit: 'm',
  margin: (s, slots) => (s['pelvis_z'] as number) - (slots['length'] as number),
};

/**
 * `track the commanded speed within {speed}`: `speed - |forward_speed - commanded_speed|`, in m/s.
 * While the episode time is under 2 s the robot is still settling, so the margin is the speed slot.
 */
export const trackSpeed: PredicateTemplate = {
  phrase: 'track the commanded speed within {speed}',
  signals: ['forward_speed', 'commanded_speed', 'episode_time'],
  unit: 'm/s',
  margin: (s, slots) => {
    const tol = slots['speed'] as number;
    if ((s['episode_time'] as number) < SETTLING_TIME) return tol;
    return tol - Math.abs((s['forward_speed'] as number) - (s['commanded_speed'] as number));
  },
};

/** `not drift sideways more than {length}`: `length - lateral_drift`, in m. */
export const noSideDrift: PredicateTemplate = {
  phrase: 'not drift sideways more than {length}',
  signals: ['lateral_drift'],
  unit: 'm',
  margin: (s, slots) => (slots['length'] as number) - (s['lateral_drift'] as number),
};

export const predicates: PredicateTemplate[] = [stayUpright, pelvisAbove, trackSpeed, noSideDrift];
