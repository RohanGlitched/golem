// Sonification numbers: drone pitch from the live margin, pan from screen x, the chord, gain caps, thud spacing. Pure.
export const MASTER_GAIN = 0.12;
export const DRONE_GAIN = 0.035;
export const THUD_GAIN = 0.07;
export const CHORD_GAIN = 0.02;
export const GAINS: readonly number[] = [MASTER_GAIN, DRONE_GAIN, THUD_GAIN, CHORD_GAIN];
export const DRONE_BASE_HZ = 55;
export const DRONE_MIN_HZ = DRONE_BASE_HZ / 2;
export const DRONE_MAX_HZ = DRONE_BASE_HZ * 2;
export const THUD_MIN_MS = 60;
export const THUD_S = 0.22;
export const CHORD_S = 1.6;
/** A5, E6, A6 with a few cents of detune: glassy, not a fanfare. */
export const CHORD: readonly { hz: number; cents: number }[] = [{ hz: 880, cents: -3 }, { hz: 1318.51, cents: 2 }, { hz: 1760, cents: 3 }];

/** Margin that moves the drone by most of an octave, per robustness unit. */
export function marginScale(unit: string): number {
  switch (unit) {
    case 'm': return 0.1;
    case 'deg': case '°': return 10;
    case 'rad': return 0.2;
    case 'm/s': return 0.15;
    case 's': return 0.5;
    case 'N': return 50;
    default: return 1;
  }
}

/** 55 Hz × 2^tanh(margin / scale): within an octave of 55 Hz, falling as the margin shrinks. Unknown margin: 55 Hz. */
export function droneHz(margin: number, scale: number): number {
  if (!(margin === margin) || !(scale > 0)) return DRONE_BASE_HZ;
  const x = margin / scale;
  const t = x > 20 ? 1 : x < -20 ? -1 : Math.tanh(x);
  return DRONE_BASE_HZ * 2 ** t;
}

/** Stereo pan from a screen x in [0, 1] (left to right). */
export function panOf(x01: number): number {
  if (!(x01 === x01)) return 0;
  const p = 2 * x01 - 1;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/** At most one thud per 60 ms. */
export class ThudLimiter {
  private last = -Infinity;
  allow(nowMs: number): boolean {
    if (nowMs - this.last < THUD_MIN_MS) return false;
    this.last = nowMs;
    return true;
  }
}
