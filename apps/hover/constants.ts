// Numbers that the hover app shares between its controller, signals, perturbations and app definition.
// scripts/fetch-assets.mjs repeats HOVER_POINT and SIM_DT (plain JS cannot import this file);
// test/assets.test.ts checks that both agree.

/** Sim timestep (s). */
export const SIM_DT = 0.002;
/** Control period (s): 100 Hz, five Sim_Steps. */
export const CONTROL_DT = 0.01;
/** Seconds before the trigger in which the drone settles on the hover point and no perturbation acts. */
export const WARMUP = 2;
/** Episode length when a line has no `for` window (s). */
export const EPISODE_SECONDS = 6;

/** The hover point (m), in the world frame. */
export const HOVER_POINT = { x: 0, y: 0, z: 1.0 } as const;
/** `initState` puts the drone this far (m, uniform per axis) from the hover point. */
export const START_OFFSET = 0.03;

/** Names for `RobotApp.names`. */
export const HOVER_NAMES = {
  body: ['x2'],
  actuator: ['thrust1', 'thrust2', 'thrust3', 'thrust4'],
  site: ['thrust1', 'thrust2', 'thrust3', 'thrust4'],
} as const;

/** The body that gusts push on. */
export const GUST_BODY = 'x2';

// ---- vehicle, from the model (test/assets.test.ts checks them against robot/x2.xml)

/** Mass of the X2 (kg). */
export const MASS = 1.325;
/** Gravity (m/s^2). */
export const GRAVITY = 9.81;
/** Moments of inertia about the centre of mass, in the body frame (kg m^2). */
export const INERTIA = { x: 0.0367, y: 0.0254, z: 0.0605 } as const;
/** Largest thrust of one motor (N): the ctrlrange upper bound. */
export const THRUST_MAX = 13;

// ---- perturbation limits

/** Longest estimate lag (s) that `begin` accepts. */
export const MAX_LAG = 0.8;
/** Battery sag below this ratio is read as this ratio: an empty battery is not a negative thrust. */
export const MIN_BATTERY = 0.05;
