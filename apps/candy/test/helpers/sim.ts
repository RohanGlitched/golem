// A minimal stand-in for the Episode_Runner loop, for controller tests that need no requirement or monitor:
// the same call order (controller.step once per Control_Step, then per Sim_Step: clear xfrc, substep, mj_step).
import { buildContext } from 'golem-spec';
import { CONTROL_DT, NUSERDATA, Q_HOME, SIM_DT, UD, WARMUP } from '../../constants';
import { CANDY_NAMES } from '../../controller/ids';
import { CandyController } from '../../controller';
import { compileRobot } from './mujoco';

export interface Sim {
  mj: any; model: any; data: any; ctx: any;
  controller: CandyController;
  /** Simulated time (s). */
  t: number;
  /** Runs `seconds` of simulation. `perSim` runs after each mj_step, `perControl` before each Control_Step. */
  run(seconds: number, hooks?: { perControl?: (t: number) => void; perSim?: (t: number) => void; beforeSim?: (t: number) => void }): void;
  dispose(): void;
}

export async function makeSim(opts: { count?: number; colours?: number[]; rng?: () => number } = {}): Promise<Sim> {
  const { mj, model } = await compileRobot();
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, CANDY_NAMES as never);
  // initState, as app.ts does it
  for (let j = 0; j < 7; j++) data.qpos[j] = Q_HOME[j];
  const ud: Float64Array = data.userdata;
  ud[UD.vacuum] = 1; ud[UD.lag] = 0; ud[UD.count] = opts.count ?? 6;
  for (let i = 0; i < 6; i++) ud[UD.colour + i] = opts.colours?.[i] ?? i % 3;
  mj.mj_forward(model, data);
  const controller = new CandyController(ctx, opts.rng ?? (() => 0.5));
  const n = Math.round(CONTROL_DT / SIM_DT);
  const sim: Sim = {
    mj, model, data, ctx, controller, t: 0,
    run(seconds, hooks = {}) {
      const end = sim.t + seconds - 1e-9;
      const xfrc: Float64Array = data.xfrc_applied;
      while (sim.t < end) {
        hooks.perControl?.(sim.t);
        controller.step(ctx, sim.t);
        for (let j = 0; j < n; j++) {
          xfrc.fill(0);
          controller.substep(ctx, sim.t);
          hooks.beforeSim?.(sim.t);
          mj.mj_step(model, data);
          sim.t += SIM_DT;
          hooks.perSim?.(sim.t);
        }
      }
    },
    dispose() { controller.dispose(); data.delete(); model.delete(); },
  };
  return sim;
}

export { WARMUP };
