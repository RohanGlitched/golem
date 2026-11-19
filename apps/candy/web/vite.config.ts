import { defineConfig } from 'vite';

// MuJoCo's WASM bundle must not be pre-bundled by Vite.
export default defineConfig({
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
});
