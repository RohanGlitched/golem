// The scene numbers that the generator needs. Plain JS cannot import constants.ts, so these repeat the
// scene part of it; test/assets.scene-gen.test.ts checks that both files agree.

export const TABLE = { xMin: -0.20, xMax: 1.00, yMin: -0.60, yMax: 0.60, thickness: 0.04 };
export const TRAY = { xMin: 0.34, xMax: 0.62, yMin: -0.16, yMax: 0.16 };
export const FLOOR_Z = -0.40;

/** Bowls in colour order: orange, purple, green. */
export const BOWLS = [
  { name: 'bowl_orange', x: 0.611, y: -0.382 },
  { name: 'bowl_purple', x: 0.720, y: 0.000 },
  { name: 'bowl_green', x: 0.611, y: 0.382 },
];
export const BOWL = { innerHalf: 0.07, wallThickness: 0.01, wallHeight: 0.05, floorRadius: 0.10, floorHalfHeight: 0.005 };

/** Halloween colours, one per bowl index. */
export const COLOURS = [
  [1.0, 0.45, 0.04, 1],
  [0.55, 0.22, 0.85, 1],
  [0.38, 0.82, 0.18, 1],
];

export const HAND_START = { x: 0.55, y: 1.10, z: 0.30, yaw: Math.PI / 2 };
export const HAND = { palmRadius: 0.05, forearmRadius: 0.04, forearmLength: 0.30 };

export const CANDY_MASS = 0.020;
export const CANDY_COUNT = 6;
export const CANDY_HALF_HEIGHT = [0.010, 0.012, 0.008, 0.010, 0.012, 0.008];

export const CONTYPE = { world: 1, arm: 2, candy: 4, cup: 8 };
export const CONAFFINITY = { world: 14, arm: 1, candy: 9, cup: 5 };
export const CUP = { radius: 0.02, length: 0.100 };
export const SUCTION = { tipInset: 0.008 };

export const SIM_DT = 0.002;
export const NUSERDATA = 24;
