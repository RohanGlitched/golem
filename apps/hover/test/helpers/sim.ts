// A minimal stand-in for the Episode_Runner loop, for controller tests that need no requirement or monitor:
// the same call order (controller.step once per Control_Step, then per Sim_Step: clear xfrc, perturbation, mj_step).
import { buildContext } from 'golem-spec';
import { CONTROL_DT, HOVER_NAMES, HOVER_POINT, SIM_DT } from '../../constants';
import { HoverController } from '../../controller';
import { runtimeFor } from '../../runtime';
import { compileRobot } from './mujoco';

export interface Sim {
  mj: any; model: any; data: any; ctx: any;
  controller: HoverController;
  /** Simulated time (s). */
  t: number;
  /** Runs `seconds` of simulation. `beforeSim` runs before each mj_step (after xfrc is cleared), `perControl` before each Control_Step. */
  run(seconds: number, hooks?: { perControl?: (t: number) => void; perSim?: (t: number) => void; beforeSim?: (t: number) => void }): void;
  dispose(): void;
}

/** A drone at `start` (default: the hover point), level and at rest, with the controller attached. */
export async function makeSim(start: [number, number, number] = [HOVER_POINT.x, HOVER_POINT.y, HOVER_POINT.z]): Promise<Sim> {
  const { mj, model } = await compileRobot();
  const data = new mj.MjData(model);
  const ctx = buildContext(mj, model, data, HOVER_NAMES as never);
  const rt = runtimeFor(ctx);
  rt.qpos[0] = start[0]; rt.qpos[1] = start[1]; rt.qpos[2] = start[2];
  rt.qpos[3] = 1; rt.qpos[4] = 0; rt.qpos[5] = 0; rt.qpos[6] = 0;
  mj.mj_forward(model, data);
  const controller = new HoverController(ctx);
  const n = Math.round(CONTROL_DT / SIM_DT);
  const sim: Sim = {
    mj, model, data, ctx, controller, t: 0,
    run(seconds, hooks = {}) {
      const end = sim.t + seconds - 1e-9;
      while (sim.t < end) {
        hooks.perControl?.(sim.t);
        controller.step(ctx, sim.t);
        for (let j = 0; j < n; j++) {
          rt.xfrc.fill(0);
          hooks.beforeSim?.(sim.t);
          mj.mj_step(model, data);
          sim.t += SIM_DT;
          hooks.perSim?.(sim.t);
        }
      }
    },
    dispose() { data.delete(); model.delete(); },
  };
  return sim;
}
