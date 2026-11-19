const SRC = 'file:///I:/Programs/ListofHackathon/hackathons/39-kiroween/golem/skeleton/src/sim/';
const { runTrial, ModelCache, liveHandleCount, loadMujoco } = await import(SRC + 'index.ts');
const mj: any = await loadMujoco();
const heapNow = () => { const { model } = { model: null as any }; return (globalThis as any).__heap?.() ?? 0; };
const XML = `<mujoco><option timestep="0.002"/><worldbody><geom name="floor" type="plane" size="5 5 .1"/>
<body name="cart" pos="0 0 0.5"><joint name="slide" type="slide" axis="1 0 0" damping="0.1"/><geom type="box" size=".2 .1 .05" mass="1"/>
<body name="pole"><joint name="hinge" type="hinge" axis="0 1 0" damping="0.01"/><geom type="capsule" fromto="0 0 0 0 0 0.6" size="0.02" mass="0.2"/></body></body>
<body name="box" pos="2 0 1"><freejoint/><geom type="box" size=".1 .1 .1" mass="1"/></body></worldbody>
<actuator><motor name="push" joint="slide" ctrlrange="-50 50"/></actuator></mujoco>`;

function mkApp(opts: { throwSignalsAt?: number } = {}) {
  let sigCalls = 0;
  const app: any = {
    id: 'cp', name: 'cartpole', sceneFile: 'scene.xml', simDt: 0.002, controlDt: 0.02, warmup: 0.2,
    files: async () => ({ 'scene.xml': new TextEncoder().encode(XML) }),
    names: { body: ['pole', 'box', 'cart'] },
    lexicon: { robotNames: ['robot'], predicates: [], perturbations: [
      { name: 'shove', phrase: 'shove', dims: () => [], apply(ctx: any, t: number, tt: number, v: any) {
        if (t >= tt && t < tt + 0.1) ctx.data.xfrc_applied[6 * ctx.ids['body:pole']] = v.force; } },
      { name: 'kick', phrase: 'kick', dims: () => [], apply(ctx: any, t: number, tt: number) {
        if (t >= tt && t < tt + 0.02) ctx.data.xfrc_applied[6 * ctx.ids['body:box'] + 2] = 1e30; } },
      { name: 'heavy', phrase: 'heavy', dims: () => [], apply(ctx: any) {
        ctx.model.body_mass[ctx.ids['body:pole']] = 5; ctx.model.opt.gravity[2] = -3;
        ctx.model.actuator_ctrlrange[1] = 1; ctx.model.jnt_stiffness[1] = 7;
        ctx.model.body_pos[3 * ctx.ids['body:box'] + 2] = 3; } },
    ] },
    initState(ctx: any, rng: () => number) { ctx.data.qpos[1] = (rng() - 0.5) * 0.1; },
    makeController() { return { step(ctx: any) { const q = ctx.data.qpos, v = ctx.data.qvel;
      ctx.data.ctrl[0] = 40 * q[1] + 8 * v[1] + 1 * q[0] + 2 * v[0]; } }; },
    signals(ctx: any, out: any) {
      if (opts.throwSignalsAt !== undefined && ++sigCalls === opts.throwSignalsAt) throw new Error('boom in signals');
      out.angle = ctx.data.qpos[1];
      out.boxz = ctx.data.xpos[3 * ctx.ids['body:box'] + 2];
      out.time = ctx.data.time;
    },
  };
  return app;
}

let lastTrace: any;
const req = (perts: any[], horizon = 2) => ({
  id: 'R1', source: 's', pattern: 'event',
  space: { dims: [{ name: 'f', kind: 'force', min: 0, max: 100, severity: 'up' }] },
  perturbations: perts, horizon,
  monitor(tr: any) {
    lastTrace = { t: Float64Array.from(tr.t), s: Object.fromEntries(Object.entries(tr.signals).map(([k, a]: any) => [k, Float64Array.from(a)])), ev: JSON.parse(JSON.stringify(tr.events)) };
    let w = Infinity, at = 0; const a = tr.signals.angle;
    for (let i = 0; i < a.length; i++) { const mm = 0.5 - Math.abs(a[i]); if (mm < w) { w = mm; at = tr.t[i]; } }
    return { robustness: w, worstAt: at, unit: 'rad' };
  },
});
const shove = { template: 'shove', params: { force: 'f' } };
const cache = new ModelCache(); (globalThis as any).__heap = () => { const c: any = (cache as any).settled; const m = [...c.values()][0]; return m ? m.body_mass.buffer.byteLength : 0; };
const app = mkApp();
const spec = { app: 'cp', reqId: 'R1', scenario: { f: 30 }, seed: 7 };

// 1 determinism
const r1 = await runTrial(app, req([shove]), spec, { cache }); const t1 = lastTrace;
const r2 = await runTrial(app, req([shove]), spec, { cache }); const t2 = lastTrace;
const same = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
console.log('1 determinism robustness', r1.robustness, r2.robustness, 'bit-identical', same(t1.s.angle, t2.s.angle) && same(t1.t, t2.t));
console.log('  trace len', t1.t.length, 't0', t1.t[0], 'tN', t1.t.at(-1), 'data.time at last sample', t1.s.time.at(-1), 'data.time at t0', t1.s.time[0]);

// 2 speed
{
  const H = 5, N = 20; const rq = req([shove], H); const t0 = performance.now();
  for (let i = 0; i < N; i++) await runTrial(app, rq, { ...spec, seed: i }, { cache });
  const ms = performance.now() - t0; const steps = N * (H + 0.2) / 0.002;
  console.log(`2 runner: ${(steps / ms).toFixed(0)} k steps/s`);
  const { model } = await cache.getModel(app); const t1_ = performance.now();
  for (let i = 0; i < N; i++) {
    const d = new mj.MjData(model); const q = d.qpos, v = d.qvel, c = d.ctrl, x = d.xfrc_applied;
    for (let s = 0; s < steps / N; s++) {
      if (s % 10 === 0) c[0] = 40 * q[1] + 8 * v[1] + q[0] + 2 * v[0];
      x.fill(0); if (s > 100 && s < 150) x[6] = 30; mj.mj_step(model, d);
    }
    d.delete();
  }
  const ms2 = performance.now() - t1_;
  console.log(`  raw loop: ${(steps / ms2).toFixed(0)} k steps/s; runner overhead ${((ms / ms2 - 1) * 100).toFixed(0)}%`);
}

// 3 poses
{
  const r = await runTrial(app, req([shove], 2), { ...spec, record: 'poses' }, { cache });
  const p = r.poses; const frames = p.frames.length / (p.nbody * 7);
  console.log(`3 poses fps=${p.fps} nbody=${p.nbody} frames=${frames} over 2 s => actual fps ${((frames - 1) / 2).toFixed(2)}`);
}

// 4 early stop
{
  let calls = 0;
  const r = await runTrial(app, req([shove]), { ...spec, scenario: { f: 100 } }, { cache, earlyStop: (_tr: any, n: number) => { calls++; return n >= 10 ? 123 : undefined; } });
  console.log('4 early stop: hook calls', calls, 'trace len', lastTrace.t.length, 'robustness returned', r.robustness, '(hook said 123)');
}

// 5 model restore without endTrial
{
  const { model } = await cache.getModel(app);
  const read = () => ({ mass: model.body_mass[2], g: model.opt.gravity[2], ctrlrange: model.actuator_ctrlrange[1], stiff: model.jnt_stiffness[1], bodypos: model.body_pos[3 * 3 + 2] });
  const before = read();
  await runTrial(app, req([{ template: 'heavy', params: {} }]), { ...spec, scenario: { f: 0 } }, { cache });
  console.log('5 before', JSON.stringify(before), '\n  after ', JSON.stringify(read()));
  model.actuator_ctrlrange[1] = 50; model.jnt_stiffness[1] = 0; model.body_pos[3 * 3 + 2] = 1;
}

// 6 divergence through the runner
{
  const r = await runTrial(app, req([{ template: 'kick', params: {} }], 1), { ...spec, scenario: { f: 0 } }, { cache });
  const bz = lastTrace.s.boxz; const tm = lastTrace.s.time;
  console.log('6 kick: robustness', r.robustness, 'events', JSON.stringify(lastTrace.ev), 'box z max', Math.max(...bz), 'data.time went backwards?', tm.some((x: number, i: number) => i > 0 && x < tm[i - 1]));
}

// 7 leak over 200 trials
{
  const h0 = liveHandleCount(); const heap0 = heapNow(); const m0 = process.memoryUsage().rss;
  for (let i = 0; i < 200; i++) await runTrial(app, req([shove], 1), { ...spec, seed: i, record: i % 2 ? 'poses' : 'none' }, { cache });
  console.log('7 200 trials: handles', h0, '->', liveHandleCount(), 'wasm heap', heap0, '->', heapNow(), 'rss MB', (m0 / 1e6).toFixed(0), '->', (process.memoryUsage().rss / 1e6).toFixed(0));
  const m1 = process.memoryUsage().rss;
  for (let i = 0; i < 200; i++) await runTrial(app, req([shove], 1), { ...spec, seed: i }, { cache });
  console.log('  next 200: rss MB', (m1 / 1e6).toFixed(0), '->', (process.memoryUsage().rss / 1e6).toFixed(0), 'wasm heap', heapNow());
}

// 8 app throws
{
  const bad = mkApp({ throwSignalsAt: 5 }); const h0 = liveHandleCount();
  try { await runTrial(bad, req([shove]), spec, { cache }); }
  catch (e: any) { console.log('8 throw:', e.message, '| cause kept', !!e.cause, '| handles', h0, '->', liveHandleCount()); }
}
