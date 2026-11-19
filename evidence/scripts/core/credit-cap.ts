// The hard credit cap of Experiment 3. The stream reports credits as the session total so far; with one prompt per
// run that total may only arrive at the end of the turn, so two guards work together:
//  - before a run: do not start if the total used plus the largest run so far (the reserve) would pass the cap;
//  - during a run: kill it as soon as an event shows the running total has reached the cap.
export interface CreditState { used: number; cap: number }

/** No run starts at or above the cap, nor when `reserve` (the largest earlier run) would take it over. */
export const canStart = (s: CreditState, reserve = 0): boolean => s.used < s.cap && s.used + reserve <= s.cap;

/** A running run must be killed as soon as the total including it reaches the cap. */
export const mustKill = (s: CreditState, runCredits: number): boolean => s.used + runCredits >= s.cap;

export const addRun = (s: CreditState, runCredits: number): CreditState => ({ ...s, used: s.used + runCredits });