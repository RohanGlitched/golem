---
inclusion: always
---
# Tech stack and rules

- **Language:** TypeScript (strict) everywhere, ES modules, Node ≥ 20. No Python in the product.
- **Physics:** `@mujoco/mujoco` (official MuJoCo WASM bindings, 4.x), identical in Node and the browser. See `mujoco-wasm.md`.
- **Rendering:** three.js (plain, no react-three-fiber), so we control render-on-demand.
- **Web:** Vite multi-page builds. React 18 only for the tablet and controls; the 3D stage is plain three.js.
- **Tests:** Vitest, plus **fast-check** for property-based tests. Every core module has properties, not just examples. See `testing.md`.
- **CLI:** `golem`, a single bin in `skeleton/` (package `golem-spec`) with a small hand-written argument parser (no heavy dependencies).
- **MCP:** `@modelcontextprotocol/sdk`, stdio server `golem mcp`.
- **Workers:** simulation runs in Web Workers in the browser (one MuJoCo instance per worker) and `worker_threads` in Node, behind one `TrialPool` interface.
- **Determinism:** every trial is a pure function of (app, requirement, scenario parameters, seed). Use a seeded PRNG (`mulberry32` / `splitmix32`), never `Math.random()` in engine code.
- **Performance budget:** no allocation inside the physics step loop; reuse typed arrays; `.delete()` every MuJoCo handle you create.
- **No network at runtime** except fetching static assets. No analytics, no trackers.
- **Licences:** our code is Apache-2.0. Unitree G1 model and policy: BSD-3-Clause (keep their notice in `apps/stagger/robot/LICENSE`). Franka Panda from MuJoCo Menagerie: Apache-2.0 (keep notice in `apps/candy/robot/LICENSE`).
