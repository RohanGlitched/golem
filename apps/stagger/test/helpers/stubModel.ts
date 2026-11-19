// A typed-array stand-in for a SimContext with a model: pelvis is body 1, floor is geom 0.
export function stubModelCtx(opts: { yaw?: number; mass?: number } = {}) {
  const yaw = opts.yaw ?? 0;
  const xquat = new Float64Array(8); xquat[0] = 1;
  xquat[4] = Math.cos(yaw / 2); xquat[7] = Math.sin(yaw / 2);
  const xpos = new Float64Array(6); xpos[5] = 0.78;
  const model = {
    opt: { gravity: Float64Array.from([0, 0, -9.81]) },
    body_mass: Float64Array.from([0, opts.mass ?? 17.7349]),
    body_inertia: Float64Array.from([0, 0, 0, 0.552723, 0.454092, 0.211762]),
    geom_friction: Float64Array.from([1, 0.005, 0.0001]),
  };
  let setConstCalls = 0;
  const mj = { mj_setConst: () => { setConstCalls++; } };
  const data = { xpos, xquat, xfrc_applied: new Float64Array(12), qvel: new Float64Array(18), time: 2 };
  return {
    ctx: { mj, model, data, ids: { 'body:pelvis': 1, 'geom:floor': 0 } as Record<string, number> },
    setConstCalls: () => setConstCalls,
  };
}
