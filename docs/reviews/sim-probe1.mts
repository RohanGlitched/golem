import load from 'file:///I:/Programs/ListofHackathon/hackathons/39-kiroween/golem/node_modules/@mujoco/mujoco/mujoco.js';
const mj: any = await load();
console.log('mjDSBL_AUTORESET', mj.mjtDisableBit?.mjDSBL_AUTORESET?.value);
const xml = `<mujoco><option timestep="0.002"/><worldbody><geom type="plane" size="5 5 .1"/>
<body name="torso" pos="0 0 1"><freejoint/><geom type="box" size=".1 .1 .3" mass="10"/></body></worldbody></mujoco>`;
mj.FS.mkdirTree('/p'); mj.FS.writeFile('/p/s.xml', new TextEncoder().encode(xml));
const m = mj.MjModel.from_xml_path('/p/s.xml');
console.log('opt is same obj?', m.opt === m.opt, 'gravity view?', m.opt.gravity instanceof Float64Array);
const g = m.opt.gravity; g[2] = -1; console.log('gravity write via view sticks:', m.opt.gravity[2]);
g[2] = -9.81;
m.opt.timestep = 0.004; console.log('timestep write sticks:', m.opt.timestep); m.opt.timestep = 0.002;
for (const disable of [false, true]) {
  const d = new mj.MjData(m);
  if (disable) m.opt.disableflags = m.opt.disableflags | mj.mjtDisableBit.mjDSBL_AUTORESET.value;
  else m.opt.disableflags = m.opt.disableflags & ~mj.mjtDisableBit.mjDSBL_AUTORESET.value;
  let anyNaN = false; let minZ = 9;
  for (let i = 0; i < 500; i++) {
    if (i >= 100 && i < 110) d.xfrc_applied[6 + 2] = 1e30; else d.xfrc_applied[6 + 2] = 0;
    mj.mj_step(m, d);
    for (const v of d.qpos) if (!Number.isFinite(v)) anyNaN = true;
  }
  const w = d.warning; let wn: number[] = [];
  try { for (let i = 0; i < 8; i++) wn.push(w.get ? w.get(i).number : w[i].number); } catch (e) { wn = ['warning read failed ' + e] as any; }
  console.log(`autoreset ${disable ? 'DISABLED' : 'enabled'}: anyNaN=${anyNaN} final z=${d.qpos[2]} time=${d.time} warnings=${JSON.stringify(wn)}`);
  d.delete();
}
m.delete();
