// Motor mixing: total thrust and three body torques in, four motor thrusts out.
//
// Motor i pushes along +z at (x_i, y_i) and adds a yaw reaction torque g_i * f_i, so
//   thrust = sum f_i,   roll = sum y_i f_i,   pitch = - sum x_i f_i,   yaw = sum g_i f_i.
// On the X2 the four columns (1, y_i, -x_i, g_i) are orthogonal, so the inverse is a sum of four scaled rows.
// The positions and yaw gears come from the model, so the mixer follows the model file.
import { THRUST_MAX } from '../constants';

export interface Mixer {
  /** Per motor: the weights of thrust, roll, pitch and yaw in that motor's thrust (N per unit). */
  readonly rows: Float64Array;
  readonly n: number;
}

/**
 * `x`, `y`: motor positions in the body frame (m) and `g`: yaw torque per newton (m). Throws when the columns are not
 * orthogonal, because the closed form below would then be wrong.
 */
export function makeMixer(x: ArrayLike<number>, y: ArrayLike<number>, g: ArrayLike<number>): Mixer {
  const n = x.length;
  if (n !== y.length || n !== g.length) throw new Error('mixer: x, y and g need one entry per motor');
  const cols = [Array.from({ length: n }, () => 1), Array.from(y), Array.from(x, (v) => -v), Array.from(g)];
  const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v * (b[i] as number), 0);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const scale = Math.sqrt(dot(cols[i] as number[], cols[i] as number[]) * dot(cols[j] as number[], cols[j] as number[]));
      if (Math.abs(dot(cols[i] as number[], cols[j] as number[])) > 1e-9 * (scale || 1)) throw new Error('mixer: motor columns are not orthogonal');
    }
  }
  const rows = new Float64Array(4 * n);
  for (let m = 0; m < n; m++) {
    for (let c = 0; c < 4; c++) {
      const col = cols[c] as number[];
      rows[4 * m + c] = (col[m] as number) / dot(col, col);
    }
  }
  return { rows, n };
}

/** Writes motor thrusts (N), limited to [0, THRUST_MAX], into `out`. */
export function mix(mixer: Mixer, thrust: number, roll: number, pitch: number, yaw: number, out: Float64Array): void {
  for (let m = 0; m < mixer.n; m++) {
    const r = mixer.rows;
    const f = r[4 * m]! * thrust + r[4 * m + 1]! * roll + r[4 * m + 2]! * pitch + r[4 * m + 3]! * yaw;
    out[m] = f < 0 ? 0 : f > THRUST_MAX ? THRUST_MAX : f;
  }
}
