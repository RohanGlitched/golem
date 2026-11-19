// Pure ghost state: frame selection, break colour, fade and summon rise for one ghost at ghost time tau.
// The shader reads breakMix, opacity and rise; this function is the CPU reference of what it shows.
import { easeOutCubic } from '../core/tween.js';

export const SUMMON_S = 0.4;
export const FADE_S = 0.6;
export const RETIRE_S = 0.3;
export const OPACITY_RUNNING = 0.55;
export const OPACITY_SURVIVOR = 0.3;

export interface GhostRecord {
  robustness: number;
  /** Absolute sim time of the worst moment, as in TrialResult. */
  worstAt: number;
  /** app.warmup: ghost time 0 is the end of warm-up (the trigger frame). */
  warmup: number;
  fps: number;
  frameCount: number;
  /** Frames before the first non-finite one (at least 1). */
  validFrames: number;
}

export interface GhostEval {
  frame: number;
  /** Index of the frame blended toward (equals frame at the end). */
  next: number;
  alpha: number;
  breakMix: 0 | 1;
  opacity: number;
  rise: number;
  hidden: boolean;
}

export const newGhostEval = (): GhostEval => ({ frame: 0, next: 0, alpha: 0, breakMix: 0, opacity: 0, rise: 0, hidden: false });

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Duration of the recording in seconds. */
export function recordingSeconds(g: Pick<GhostRecord, 'fps' | 'frameCount'>): number {
  return g.frameCount > 1 && g.fps > 0 ? (g.frameCount - 1) / g.fps : 0;
}

/** Ghost time at which the ghost breaks: clamp(worstAt - warmup, 0, T). */
export function breakTime(g: GhostRecord): number {
  const T = recordingSeconds(g);
  const tb = g.worstAt - g.warmup;
  return Number.isFinite(tb) ? clamp(tb, 0, T) : (tb > 0 ? T : 0);
}

/**
 * Writes the state of ghost g at ghost time tau into out. No allocation. iseTau is the time since the
 * ghost was summoned (a staged ghost rises while it holds the trigger frame); it defaults to tau.
 */
export function evalGhost(g: GhostRecord, tau: number, reduced: boolean, out: GhostEval, riseTau = tau): GhostEval {
  if (!(tau > 0)) tau = 0;
  if (!(riseTau > 0)) riseTau = 0;
  const T = recordingSeconds(g);
  const t = tau < T ? tau : T;
  const last = Math.max(0, Math.min(g.frameCount, g.validFrames) - 1);
  const x = t * g.fps;
  let f = Math.floor(x);
  let alpha = reduced ? 0 : x - f;
  if (f >= last) { f = last; alpha = 0; }
  out.frame = f;
  out.next = f < last ? f + 1 : f;
  out.alpha = alpha;

  const broke = g.robustness < 0;
  const tBreak = breakTime(g);
  const rise = reduced ? 0 : 1 - easeOutCubic(clamp(riseTau / SUMMON_S, 0, 1));
  out.rise = rise;
  out.hidden = false;
  let opacity: number;
  if (broke && tau >= tBreak) {
    out.breakMix = 1;
    const fade = reduced ? 1 : clamp((tau - tBreak) / FADE_S, 0, 1);
    opacity = OPACITY_RUNNING * (1 - fade);
    out.hidden = fade >= 1;
  } else {
    out.breakMix = 0;
    opacity = broke ? OPACITY_RUNNING : OPACITY_SURVIVOR;
  }
  out.opacity = reduced ? opacity : opacity * (1 - rise);
  return out;
}

/** Opacity multiplier of a retiring ghost (leftover slot of a previous Generation), 1 to 0 over 300 ms. */
export function retireFactor(sinceSec: number, reduced: boolean): number {
  if (reduced) return 0;
  return 1 - clamp(sinceSec / RETIRE_S, 0, 1);
}
