const SRC = 'file:///I:/Programs/ListofHackathon/hackathons/39-kiroween/golem/skeleton/src/sim/';
const { runTrial, ModelCache } = await import(SRC + 'index.ts');
const XML = `<mujoco><option timestep="0.002"/><worldbody><geom type="plane" size="5 5 .1"/>
<body name="pelvis" pos="0 0 0.8"><freejoint/><geom type="box" size=".1 .1 .1" mass="1"/><site name="imu"/></body></worldbody>
<sensor><framezaxis objtype="site" objname="imu"/></sensor></mujoco>`;
const seen: any[] = [];
const app: any = {
  id: 'w0', name: 'w0', sceneFile: 'scene.xml', simDt: 0.002, controlDt: 0.02, warmup: 0,
  files: async () => ({ 'scene.xml': new TextEncoder().encode(XML) }),
  names: { body: ['pelvis'] },
  lexicon: { robotNames: ['robot'], predicates: [], perturbations: [] },
  initState(ctx: any) { ctx.data.qpos[2] = 0.9; },
  makeController() { return { step(ctx: any) { if (seen.length === 0) seen.push({ firstCtrlSensor: Array.from(ctx.data.sensordata) }); } }; },
  signals(ctx: any, out: any) { out.z = ctx.data.xpos[3 * ctx.ids['body:pelvis'] + 2]; },
};
let z0 = NaN;
const req = { id: 'R', source: 's', pattern: 'ubiquitous', space: { dims: [] }, perturbations: [], horizon: 0.1,
  monitor(tr: any) { z0 = tr.signals.z[0]; return { robustness: 1, worstAt: 0, unit: 'm' }; } };
await runTrial(app, req, { app: 'w0', reqId: 'R', scenario: {}, seed: 1 }, { cache: new ModelCache() });
console.log('warmup=0: pelvis z at sample 0 =', z0, '(qpos z set to 0.9); sensordata at first controller step =', JSON.stringify(seen[0]));
