// The pick-and-place state machine as data: a frozen transition table that a test can enumerate, and a pure
// `next`. The machine reads no wall clock and draws no random number: guards come from simulated time and signals.

export const STATES = Object.freeze(['idle', 'approach', 'descend', 'grasp', 'lift', 'transfer', 'release', 'homing'] as const);
export type StateId = (typeof STATES)[number];

/**
 * What the controller evaluates each Control_Step before asking for a transition.
 *  candidate     t >= T_READY and a candy is waiting on the tray (idle)
 *  ikFail        the IK error for the current waypoint is above 0.005 m (approach, descend)
 *  atAbove       the tip is within 0.01 m of the point above the candy (approach)
 *  nearCandy     the tip is within 0.01 m of the candy centre (descend)
 *  lost          the held candy is farther than 0.01 m from the tip (grasp, lift, transfer)
 *  dwellDone     the 0.3 s dwell has run out (grasp, release)
 *  lifted        the tip is within 0.01 m of the lift height (lift)
 *  atBowl        the tip is within 0.01 m of the point above the bowl (transfer)
 *  homeReached   every joint is within 0.02 rad of the Home_Pose (homing)
 */
export interface Guards {
  candidate: boolean; ikFail: boolean; atAbove: boolean; nearCandy: boolean; lost: boolean;
  dwellDone: boolean; lifted: boolean; atBowl: boolean; homeReached: boolean;
}
export type GuardId = keyof Guards;

/** What the controller does when a transition fires. */
export type ActionId =
  | 'chooseCandy' | 'skipCandy' | 'startDescent' | 'switchOn' | 'switchOff' | 'startLift' | 'startTransfer'
  | 'release' | 'startHoming' | 'none';

export interface Transition { readonly from: StateId; readonly guard: GuardId; readonly to: StateId; readonly action: ActionId }

const t = (from: StateId, guard: GuardId, to: StateId, action: ActionId): Transition => Object.freeze({ from, guard, to, action });

/**
 * Table order is priority order within one state: a failure or a lost candy is checked before progress.
 * `lost` does not set the skip bit, so a candy that slipped becomes a candidate again.
 */
export const TRANSITIONS: readonly Transition[] = Object.freeze([
  t('idle', 'candidate', 'approach', 'chooseCandy'),
  t('approach', 'ikFail', 'idle', 'skipCandy'),
  t('approach', 'atAbove', 'descend', 'startDescent'),
  t('descend', 'ikFail', 'idle', 'skipCandy'),
  t('descend', 'nearCandy', 'grasp', 'switchOn'),
  t('grasp', 'lost', 'idle', 'switchOff'),
  t('grasp', 'dwellDone', 'lift', 'startLift'),
  t('lift', 'lost', 'idle', 'switchOff'),
  t('lift', 'lifted', 'transfer', 'startTransfer'),
  t('transfer', 'lost', 'idle', 'switchOff'),
  t('transfer', 'atBowl', 'release', 'release'),
  t('release', 'dwellDone', 'homing', 'startHoming'),
  t('homing', 'homeReached', 'idle', 'none'),
]);

/** The first transition of `state` whose guard holds, or undefined. At most one transition fires per step. */
export function next(state: StateId, guards: Readonly<Guards>): Transition | undefined {
  for (let i = 0; i < TRANSITIONS.length; i++) {
    const tr = TRANSITIONS[i] as Transition;
    if (tr.from === state && guards[tr.guard]) return tr;
  }
  return undefined;
}

export function makeGuards(): Guards {
  return {
    candidate: false, ikFail: false, atAbove: false, nearCandy: false, lost: false,
    dwellDone: false, lifted: false, atBowl: false, homeReached: false,
  };
}

/** States in which suction is on: from `grasp` through `transfer`. */
export function suctionOn(state: StateId): boolean {
  return state === 'grasp' || state === 'lift' || state === 'transfer';
}
