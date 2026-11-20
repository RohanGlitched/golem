// Vite multi-page build of the GOLEM site. Pages are rendered from committed data by src/build/pages-plugin.ts.
import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pagesPlugin, robotFilesPlugin, seedsPlugin, PAGE_ENTRIES } from './src/build/pages-plugin';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const skeleton = (p: string): string => here(`../skeleton/src/${p}`);

// An app that is not in this checkout resolves to a stub, so the build tolerates its absence (the page says so).
const appFile = (id: string, file: string, kind = '.ts'): string => {
  const p = here(`../apps/${id}/${file}`);
  return existsSync(p) ? p : here(kind === '.md' ? './src/studio/absent.md' : './src/studio/absent.ts');
};

// The skeleton is not built in a fresh checkout, so its public entry points resolve to the sources
// (the apps' own vitest configs do the same). Import specifiers stay the public ones.
export const alias = [
  { find: /^golem-spec\/ui\/worker$/, replacement: skeleton('ui/worker.ts') },
  { find: /^golem-spec\/ui$/, replacement: skeleton('ui/index.ts') },
  { find: /^golem-spec\/node$/, replacement: skeleton('node.ts') },
  { find: /^golem-spec$/, replacement: skeleton('index.ts') },
  { find: /^golem-pool-entry(\?.*)?$/, replacement: skeleton('pool/browser-entry.ts') + '$1' },
  { find: /^@app\/stagger$/, replacement: appFile('stagger', 'app.ts') },
  { find: /^@app\/candy$/, replacement: appFile('candy', 'app.ts') },
  { find: /^@app\/hover$/, replacement: appFile('hover', 'app.ts') },
  { find: /^@app\/yard-stand$/, replacement: appFile('yard', 'stand.ts') },
  { find: /^@spec\/yard(\?.*)?$/, replacement: appFile('yard', '.kiro/specs/stand-push/requirements.md', '.md') + '$1' },
  { find: /^@spec\/stagger(\?.*)?$/, replacement: appFile('stagger', '.kiro/specs/g1-walking/requirements.md', '.md') + '$1' },
  { find: /^@spec\/candy(\?.*)?$/, replacement: appFile('candy', '.kiro/specs/candy-sorter/requirements.md', '.md') + '$1' },
  { find: /^@spec\/hover(\?.*)?$/, replacement: appFile('hover', '.kiro/specs/hover-hold/requirements.md', '.md') + '$1' },
];

export default defineConfig({
  appType: 'mpa',
  plugins: [pagesPlugin(), robotFilesPlugin(), seedsPlugin()],
  resolve: { alias },
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  esbuild: { jsx: 'automatic' },
  worker: { format: 'es' },
  server: { fs: { allow: [here('..')] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: Object.fromEntries(PAGE_ENTRIES.map((p) => [p.name, here(p.file)])) },
  },
});
