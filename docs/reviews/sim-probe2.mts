import load from '@mujoco/mujoco';
const mj: any = await load();
const xml = `<mujoco><option timestep="0.002"/><worldbody><geom type="plane" size="5 5 .1"/>
<body name="torso" pos="0 0 1"><freejoint/><geom type="box" size=".1 .1 .3" mass="10"/></body></worldbody></mujoco>`;
mj.FS.mkdirTree('/p'); mj.FS.writeFile('/p/s.xml', new TextEncoder().encode(xml));
const m = mj.MjModel.from_xml_path('/p/s.xml');
const d = new mj.MjData(m);
for (let i = 0; i < 500; i++) { d.xfrc_applied[8] = (i >= 100 && i < 110) ? 1e30 : 0; mj.mj_step(m, d); }
const w = d.warning; console.log('warning vec size', w.size());
const out: any = {}; for (let i = 0; i < w.size(); i++) { const s = w.get(i); out[i] = s.number; s.delete?.(); } w.delete();
console.log('warnings (autoreset on):', JSON.stringify(out), 'z', d.qpos[2]);
