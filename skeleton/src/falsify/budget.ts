// Budget validation and accounting. A shrink reserve sits on top of the search budget (approved change):
// max(reserveMin, ceil(reserveFraction * maxTrials)) shrink trials, and the same fraction of extra wall time.
import type { Budget } from './types.js';

export interface BudgetConfig {
  phase1Fraction: number;
  phase2Fraction: number;
  randomOnly: boolean;
  reserveFraction: number;
  reserveMin: number;
}

function isPositiveFinite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/** Throws RangeError that names the field and the value. Runs before any trial. */
export function validateBudget(budget: Budget, phase1Fraction: number, phase2Fraction: number): void {
  const { maxTrials, maxWallMs } = budget;
  if (maxTrials === undefined && maxWallMs === undefined) {
    throw new RangeError('budget has neither budget.maxTrials nor budget.maxWallMs; give at least one');
  }
  if (maxTrials !== undefined && (!isPositiveFinite(maxTrials) || !Number.isInteger(maxTrials))) {
    throw new RangeError(`budget.maxTrials must be a positive integer, got ${String(maxTrials)}`);
  }
  if (maxWallMs !== undefined && !isPositiveFinite(maxWallMs)) {
    throw new RangeError(`budget.maxWallMs must be a positive finite number, got ${String(maxWallMs)}`);
  }
  for (const [name, f] of [['phase1Fraction', phase1Fraction], ['phase2Fraction', phase2Fraction]] as const) {
    if (typeof f !== 'number' || !(f >= 0 && f <= 1)) {
      throw new RangeError(`${name} must be in [0, 1], got ${String(f)}`);
    }
  }
  if (phase1Fraction + phase2Fraction > 1 + 1e-12) {
    throw new RangeError(
      `phase1Fraction (${phase1Fraction}) + phase2Fraction (${phase2Fraction}) = ${phase1Fraction + phase2Fraction} exceeds 1`,
    );
  }
}

export type SearchPhase = 0 | 1 | 2;

export class BudgetClock {
  readonly maxTrials: number | null;
  readonly maxWallMs: number | null;
  /** Shrink trials allowed on top of maxTrials; null without a trial limit. */
  readonly shrinkReserve: number | null;
  private t0 = 0;
  private readonly used: [number, number, number] = [0, 0, 0];
  private shrinkUsedCount = 0;

  constructor(
    budget: Budget,
    private readonly cfg: BudgetConfig,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.maxTrials = budget.maxTrials ?? null;
    this.maxWallMs = budget.maxWallMs ?? null;
    this.shrinkReserve = this.maxTrials === null
      ? null
      : Math.max(cfg.reserveMin, Math.ceil(cfg.reserveFraction * this.maxTrials));
  }

  start(): void { this.t0 = this.now(); }
  elapsedMs(): number { return this.now() - this.t0; }

  get searchUsed(): number { return this.used[0] + this.used[1] + this.used[2]; }
  get shrinkUsed(): number { return this.shrinkUsedCount; }
  phaseUsed(p: SearchPhase): number { return this.used[p]; }

  /** Search trials left in the whole budget (Infinity without a trial limit). */
  remainingSearch(): number {
    return this.maxTrials === null ? Infinity : Math.max(0, this.maxTrials - this.searchUsed);
  }
  trialsExhausted(): boolean { return this.remainingSearch() <= 0; }

  /** Trials remaining in the budget as shown in progress events (search budget only). */
  remainingForProgress(): number | null {
    return this.maxTrials === null ? null : this.remainingSearch();
  }

  private quota(phase: SearchPhase): number {
    if (this.maxTrials === null) return Infinity;
    const T = this.maxTrials;
    const remaining0 = T - this.used[0];
    if (phase === 0) return T;
    const q1 = this.cfg.randomOnly ? remaining0 : Math.min(remaining0, Math.floor(this.cfg.phase1Fraction * T));
    if (phase === 1) return q1;
    return Math.min(T - this.used[0] - this.used[1], Math.floor(this.cfg.phase2Fraction * T) + (q1 - this.used[1]));
  }

  private deadlineMs(phase: SearchPhase | 3): number {
    const W = this.maxWallMs;
    if (W === null) return Infinity;
    if (phase === 0) return W;
    if (phase === 1) return this.cfg.randomOnly ? W : this.cfg.phase1Fraction * W;
    if (phase === 2) return Math.min(1, this.cfg.phase1Fraction + this.cfg.phase2Fraction) * W;
    return W * (1 + this.cfg.reserveFraction);
  }

  timeExhausted(phase: SearchPhase | 3): boolean {
    return this.maxWallMs !== null && this.elapsedMs() >= this.deadlineMs(phase);
  }

  /** Trials the next generation of `phase` may run (0 ends the phase). */
  grant(phase: SearchPhase, wanted: number): number {
    if (this.timeExhausted(phase)) return 0;
    const left = Math.max(0, Math.min(this.quota(phase) - this.used[phase], this.remainingSearch()));
    return Math.max(0, Math.min(wanted, left));
  }

  record(phase: SearchPhase, n: number): void { this.used[phase] += n; }

  /** 1 when one more shrink trial may start, else 0. */
  grantShrink(): number {
    if (this.timeExhausted(3)) return 0;
    if (this.shrinkReserve !== null && this.shrinkUsedCount >= this.shrinkReserve) return 0;
    return 1;
  }
  recordShrink(n: number): void { this.shrinkUsedCount += n; }
}
