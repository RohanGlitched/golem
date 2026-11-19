// The four G1 predicates. Each margin is positive when the predicate holds and is measured in the
// predicate's unit, so robustness reads as a physical distance from failure.
import type { PredicateTemplate } from './contract.js';

export const UPRIGHT_HEIGHT = 0.5;      // m
export const UPRIGHT_TILT_LIMIT = 60;   // deg
export const FALLEN_MARGIN = -0.01;     // m (kept for older seeds' reports; no longer used by stay upright)
/** Converts tilt headroom to metres so both parts of the upright margin share one unit: 5 mm per degree. */
export const TILT_TO_M = 0.005;         // m/deg
export const SETTLING_TIME = 2;         // s of episode time

/**
 * `stay upright`: the margin is the smaller of the height headroom `pelvis_z - 0.5 m` and the tilt
 * headroom `(60 deg - tilt) x 5 mm/deg`, in metres. It is positive exactly when the pelvis is above
 * 0.5 m and the tilt is under 60 deg, so the verdict is unchanged. Unlike a fixed "fallen" value it is
 * graded: a robot that staggers to 45 deg and recovers scores 0.075 m, one that barely sways scores
 * about 0.27 m. That gradient is what lets GOLEM's guided search home in on the pushes that come
 * closest to toppling the robot, instead of searching blind until one actually falls.
 */
export const stayUpright: PredicateTemplate = {
  phrase: 'stay upright',
  signals: ['pelvis_z', 'tilt_deg'],
  unit: 'm',
  margin: (s) => Math.min((s['pelvis_z'] as number) - UPRIGHT_HEIGHT, (UPRIGHT_TILT_LIMIT - (s['tilt_deg'] as number)) * TILT_TO_M),
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
