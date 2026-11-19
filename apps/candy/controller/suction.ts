// Suction model: a capped spring-damper that pulls the nearest candy toward the tip, applied through
// data.xfrc_applied once per Sim_Step (Controller.substep). The reaction on the cup is not applied: the
// suction stands for an external air force.
//
//   F  = k (p_tip - p_candy) + c (v_tip - v_candy)
//   F' = F * min(1, F_cap / |F|),   F_cap = Holding_Force * Vacuum_Ratio
//
// suctionForce and sanitizeRatio are pure. suctionStep reads the live MuJoCo views cached in a
// SuctionWorkspace and allocates nothing.
import { CANDY_COUNT, SUCTION, UD } from '../constants';
import type { SimContext } from '../contract';

export interface SuctionIds {
  /** `tip` site id. */
  tipSite: number;
  /** Address of each candy's free joint in qpos (x, y, z, then the quaternion). */
  candyQpos: Int32Array;
  /** Address of each candy's free joint in qvel (vx, vy, vz, then the angular velocity). */
  candyDof: Int32Array;
  /** Body id of each candy (row of xfrc_applied). */
  candyBody: Int32Array;
}

/** Clamps a vacuum ratio into [0, 1]; a value that is not finite becomes 0. */
export function sanitizeRatio(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The message recorded when a vacuum ratio had to be clamped. */
export function vacuumWarning(original: number): string {
  return `Vacuum_Ratio ${original} is outside [0, 1]; using ${sanitizeRatio(original)}`;
}

/**
 * Writes the capped spring-damper force on the candy into `out` (3 values, N). The direction of the force
 * is kept when its magnitude is scaled down to `cap` (N). A zero force gives exactly +0.
 */
export function suctionForce(
  out: Float64Array, tip: ArrayLike<number>, vTip: ArrayLike<number>,
  candy: ArrayLike<number>, vCandy: ArrayLike<number>, cap: number,
): void {
  const k = SUCTION.k, c = SUCTION.c;
  const fx = k * ((tip[0] as number) - (candy[0] as number)) + c * ((vTip[0] as number) - (vCandy[0] as number));
  const fy = k * ((tip[1] as number) - (candy[1] as number)) + c * ((vTip[1] as number) - (vCandy[1] as number));
  const fz = k * ((tip[2] as number) - (candy[2] as number)) + c * ((vTip[2] as number) - (vCandy[2] as number));
  const mag = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (mag === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  const s = mag > cap ? cap / mag : 1;
  out[0] = fx * s + 0; out[1] = fy * s + 0; out[2] = fz * s + 0;
}

/** Live views and scratch arrays of one trial. Created once; `sync` re-reads the views after WASM memory growth. */
export class SuctionWorkspace {
  userdata!: Float64Array;
  xfrc!: Float64Array;
  qpos!: Float64Array;
  qvel!: Float64Array;
  siteXpos!: Float64Array;
  readonly force = new Float64Array(3);
  readonly tip = new Float64Array(3);
  readonly vTip = new Float64Array(3);
  readonly candy = new Float64Array(3);
  readonly vCandy = new Float64Array(3);
  readonly prevTip = new Float64Array(3);
  prevValid = false;
  readonly invDt: number;

  constructor(ctx: SimContext) {
    const dt = ctx.model?.opt?.timestep;
    this.invDt = typeof dt === 'number' && dt > 0 ? 1 / dt : 500;
    this.read(ctx.data);
  }

  private read(data: any): void {
    this.userdata = data.userdata; this.xfrc = data.xfrc_applied; this.qpos = data.qpos;
    this.qvel = data.qvel; this.siteXpos = data.site_xpos;
  }

  /** Re-reads the views when WASM memory growth detached any of them. */
  sync(data: any): void {
    if (this.userdata.buffer.byteLength === 0 || this.xfrc.buffer.byteLength === 0 || this.qpos.buffer.byteLength === 0
      || this.qvel.buffer.byteLength === 0 || this.siteXpos.buffer.byteLength === 0) this.read(data);
  }
}

/**
 * One Sim_Step of suction. Adds into data.xfrc_applied and never clears it. While the switch is off it
 * returns without writing anything to MuJoCo. Otherwise it picks the active candy nearest to the tip (lower
 * index on ties) and, if that candy is within the engage radius, adds the capped force to its row.
 */
export function suctionStep(mj: any, ctx: SimContext, ids: SuctionIds, ws: SuctionWorkspace): void {
  ws.sync(ctx.data);
  const ud = ws.userdata;
  if ((ud[UD.switch] as number) < 0.5) { ws.prevValid = false; return; }

  // The switch is on: refresh the kinematics so that the tip is where the arm is now, not one step ago.
  mj.mj_kinematics(ctx.model, ctx.data);
  const s = 3 * ids.tipSite;
  const tx = ws.siteXpos[s] as number, ty = ws.siteXpos[s + 1] as number, tz = ws.siteXpos[s + 2] as number;
  ws.tip[0] = tx; ws.tip[1] = ty; ws.tip[2] = tz;
  if (ws.prevValid) {
    ws.vTip[0] = (tx - (ws.prevTip[0] as number)) * ws.invDt;
    ws.vTip[1] = (ty - (ws.prevTip[1] as number)) * ws.invDt;
    ws.vTip[2] = (tz - (ws.prevTip[2] as number)) * ws.invDt;
  } else {
    ws.vTip[0] = 0; ws.vTip[1] = 0; ws.vTip[2] = 0;
  }
  ws.prevTip[0] = tx; ws.prevTip[1] = ty; ws.prevTip[2] = tz;
  ws.prevValid = true;

  const raw = ud[UD.vacuum] as number;
  const ratio = sanitizeRatio(raw);
  if (!(raw >= 0 && raw <= 1) && !Object.is(ud[UD.warnValue], raw)) {
    ud[UD.warnCount] = (ud[UD.warnCount] as number) + 1;
    ud[UD.warnValue] = raw;
  }

  const n = Math.min(CANDY_COUNT, Math.round(ud[UD.count] as number));
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < n; i++) {
    const q = ids.candyQpos[i] as number;
    const dx = (ws.qpos[q] as number) - tx, dy = (ws.qpos[q + 1] as number) - ty, dz = (ws.qpos[q + 2] as number) - tz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  if (best < 0 || Math.sqrt(bestD2) > SUCTION.engageRadius) { ud[UD.target] = -1; return; }

  const q = ids.candyQpos[best] as number;
  const d = ids.candyDof[best] as number;
  ws.candy[0] = ws.qpos[q] as number; ws.candy[1] = ws.qpos[q + 1] as number; ws.candy[2] = ws.qpos[q + 2] as number;
  ws.vCandy[0] = ws.qvel[d] as number; ws.vCandy[1] = ws.qvel[d + 1] as number; ws.vCandy[2] = ws.qvel[d + 2] as number;
  suctionForce(ws.force, ws.tip, ws.vTip, ws.candy, ws.vCandy, SUCTION.holdingForce * ratio);
  const r = 6 * (ids.candyBody[best] as number);
  ws.xfrc[r] = (ws.xfrc[r] as number) + (ws.force[0] as number);
  ws.xfrc[r + 1] = (ws.xfrc[r + 1] as number) + (ws.force[1] as number);
  ws.xfrc[r + 2] = (ws.xfrc[r + 2] as number) + (ws.force[2] as number);
  ud[UD.target] = best;
}
