// Every number that the candy-app requirements leave to the design. SI units throughout.
// Frame: x forward from the Panda base, y to the left, z up. The origin is on the Table surface,
// directly under the Panda base axis. Azimuth angles are about +z, 0 along +x, counter-clockwise from above.

export const TABLE = { xMin: -0.20, xMax: 1.00, yMin: -0.60, yMax: 0.60, thickness: 0.04 } as const;
export const TRAY = { xMin: 0.34, xMax: 0.62, yMin: -0.16, yMax: 0.16 } as const;
export const WORKSPACE = { xMin: 0.15, xMax: 0.90, yMin: -0.55, yMax: 0.55, zMin: 0, zMax: 0.50 } as const;
/** Floor height below the Table surface. */
export const FLOOR_Z = -0.40;
/** Origin of the hand-entry rays. */
export const WORKSPACE_CENTRE = { x: 0.55, y: 0 } as const;

/** Bowls in colour order: index 0 orange, 1 purple, 2 green. */
export const BOWLS: readonly { name: string; x: number; y: number }[] = [
  { name: 'bowl_orange', x: 0.611, y: -0.382 },
  { name: 'bowl_purple', x: 0.720, y: 0.000 },
  { name: 'bowl_green', x: 0.611, y: 0.382 },
];
export const BOWL = {
  /** Inner half-width of the square bowl. */
  innerHalf: 0.07,
  wallThickness: 0.01,
  wallHeight: 0.05,
  floorRadius: 0.10,
  floorHalfHeight: 0.005,
  /** Height above the Table at which a resting candy centre can lie inside the bowl. */
  zMax: 0.06,
} as const;

/** Halloween colours, one per bowl index. Bowl and candy geoms share these rgba values exactly. */
export const COLOURS: readonly { name: string; rgba: readonly [number, number, number, number] }[] = [
  { name: 'orange', rgba: [1.0, 0.45, 0.04, 1] },
  { name: 'purple', rgba: [0.55, 0.22, 0.85, 1] },
  { name: 'green', rgba: [0.38, 0.82, 0.18, 1] },
];

/** The Franka "ready" pose. */
export const Q_HOME: readonly number[] = [0, -0.7854, 0, -2.3562, 0, 1.5708, 0.7854];

/** Panda joint limits (rad), from the Menagerie model. */
export const JOINT_RANGE: readonly (readonly [number, number])[] = [
  [-2.8973, 2.8973], [-1.7628, 1.7628], [-2.8973, 2.8973], [-3.0718, -0.0698],
  [-2.8973, 2.8973], [-0.0175, 3.7525], [-2.8973, 2.8973],
];

/** Palm centre and yaw of the Hand at rest. The forearm extends away from the Table along +y. */
export const HAND_START = { x: 0.55, y: 1.10, z: 0.30, yaw: Math.PI / 2 } as const;
export const HAND = { palmRadius: 0.05, forearmRadius: 0.04, forearmLength: 0.30 } as const;
export const HAND_HEIGHT_RANGE = { min: 0.05, max: 0.25 } as const;
/** Fallback for the hand-entry range when the compiler passes no horizon (s). */
export const HAND_ENTRY_FALLBACK = 3.0;
/** Tip position at the Home_Pose, measured by test/scene.test.ts: flange 0.590 m, cup face 0.490 m, tip 8 mm below it. */
export const TIP_HOME_ESTIMATE = { x: 0.307, y: 0, z: 0.482 } as const;

// ---------------------------------------------------------------- candy

export const CANDY_COUNT = 6;
export const CANDY_MASS = 0.020;
export const CANDY_MASS_RANGE = { min: 0.005, max: 0.060 } as const;
/** Vertical half-extent of candy i (box, sphere, capsule). */
export const CANDY_HALF_HEIGHT: readonly number[] = [0.010, 0.012, 0.008, 0.010, 0.012, 0.008];
export const CANDY_SPAWN = { xMin: 0.35, xMax: 0.39, yMin: -0.13, yMax: 0.13 } as const;
/** Overlap distance: largest horizontal diameter 0.032 m plus 4 mm. */
export const D_OV = 0.036;
export const OVERLAP_STEP = 0.01;
export const RESTING_SPEED = 0.05;
export const DROPPED_Z = 0.04;
export const PARK = { x: -0.60, dx: -0.05, y: 0.90, z: -0.38 } as const;

// ---------------------------------------------------------------- collision filter

export const CONTYPE = { world: 1, arm: 2, candy: 4, cup: 8 } as const;
export const CONAFFINITY = { world: 14, arm: 1, candy: 9, cup: 5 } as const;

// ---------------------------------------------------------------- suction

/** 	ipInset: the tip site lies this far beyond the cup face, toward the candy (see scripts/lib/patch.mjs). */
export const SUCTION = { k: 400, c: 2, holdingForce: 3, engageRadius: 0.01, tipInset: 0.008 } as const;
export const CUP = { radius: 0.02, length: 0.100 } as const;

// ---------------------------------------------------------------- safety

export const SSM = { slowdown: 0.40, stop: 0.15 } as const;
export const DISTMAX = 0.6;

// ---------------------------------------------------------------- timing

export const SIM_DT = 0.002;
export const CONTROL_DT = 0.02;
export const WARMUP = 1.0;
/** Control gate: the controller starts picking after the candies have settled. */
export const T_READY = WARMUP + 0.3;
export const DWELL_STEPS = Math.round(0.3 / CONTROL_DT);
export const DELAY_LENGTH = Math.ceil(0.3 / CONTROL_DT) + 1;
export const MAX_TRACKER_LAG = 0.3;

// ---------------------------------------------------------------- controller

export const CTRL = {
  vNom: 0.50,
  aUp: 2.5,
  approachHeight: 0.10,
  liftHeight: 0.15,
  releaseHeight: 0.10,
  guardRadius: 0.01,
  homeGuard: 0.02,
  /** Descent target: candy centre plus this offset in z. */
  descendOffset: 0.005,
  homingRate: 0.5,
  skipError: 0.005,
} as const;

export const IK = {
  lambda0: 0.05,
  lambdaMax: 0.20,
  mu0: 0.02,
  tiltWeight: 0.15,
  stepLimit: 0.10,
  maxIterations: 200,
  posTol: 1e-3,
  tiltTol: (1 * Math.PI) / 180,
} as const;

/** Reachable box for IK tests. */
export const REACHABLE = { xMin: 0.30, xMax: 0.78, yAbsMax: 0.40, rMax: 0.74, zMin: 0.00, zMax: 0.30 } as const;

// ---------------------------------------------------------------- userdata layout

export const NUSERDATA = 24;
export const UD = {
  vacuum: 0, lag: 1, count: 2, switch: 3, target: 4, warnCount: 5, warnValue: 6, colour: 8,
} as const;
