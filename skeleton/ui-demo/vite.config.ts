import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
