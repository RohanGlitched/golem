---
inclusion: fileMatch
fileMatchPattern: ["skeleton/src/sim/**", "skeleton/src/pool/**", "apps/**/controller/**", "apps/**/app.ts", "apps/**/scripts/**"]
---
# MuJoCo WASM rules (learned the hard way)

- Package: `@mujoco/mujoco` 4.x: `import load from '@mujoco/mujoco'; const mj = await load();`. It works in Node (≈0.45 s load) and in Vite. In Vite, add `optimizeDeps.exclude: ['@mujoco/mujoco']`.
- **Write model files with `mj.FS.mkdirTree` + `mj.FS.writeFile`**, then `mj.MjModel.from_xml_path('/robot/scene.xml')`. `MjVFS.addBuffer` is ~600× slower for MB-sized meshes (13 s vs 20 ms).
- Enum values need `.value`: `mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, 'pelvis')`.
- `data.qpos`, `qvel`, `ctrl`, `xfrc_applied`, `xpos`, `xquat`, `xmat`, `site_xpos` are **live views** into WASM memory. Re-read the view after a model reload. Never keep a view past `data.delete()`.
- `data.contact` is a **copy** (a vector handle): read it once per step if needed, and `.delete()` it.
- Out-parameters (Jacobians and friends) need `new mj.DoubleBuffer(n)` (4.0.1 takes a length; the array form throws). Read `.GetView()`, then `.delete()`. Passing a plain `Float64Array` silently writes nowhere. Use the `sim` helpers instead of raw buffers.
- **Auto-reset hides divergence:** MuJoCo silently resets `qpos` on bad accelerations unless `mjDSBL_AUTORESET` is set. A reset robot looks upright, so trials must disable auto-reset and treat any `data.warning` count increase as divergence.
- `mj_geomDistance(m, d, g1, g2, distmax, fromto)` gives signed distance between two geoms. Use it for separation monitors.
- `data.eq_active` is writable at runtime (toggle welds).
- Every `MjData` / `MjModel` / buffer you create must be `.delete()`d. Trials create one `MjData` each and delete it at the end.
- Raw Unitree meshes take 52 s to load. Use precomputed **convex-hull collision meshes plus ≤3k-face visual meshes**: same dynamics, 3 s load.
- Unitree G1 policy notes: the observation's gravity vector reads (0, 0, −1) when upright. Control at 50 Hz (decimation 10 at dt 0.002). Gait phase period is 0.8 s. Action scale is 0.25 around the default pose. PD gains kp = [100,100,100,150,40,40]×2, kd = [2,2,2,4,2,2]×2.
- Speed: a single thread runs about 8× real time for G1. Budget ≈0.6 s CPU per 5 s trial.
