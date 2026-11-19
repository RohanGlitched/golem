import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const WEB = fileURLToPath(new URL('.', import.meta.url));
const ROBOT = resolve(WEB, '../robot');
const REPO = resolve(WEB, '../../..');

const MIME: Record<string, string> = { '.xml': 'application/xml', '.obj': 'text/plain', '.json': 'application/json', '.png': 'image/png' };

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Serves apps/candy/robot at /robot/ and copies it to dist/robot/, so the studio fetches the robot files from its own origin. */
function robotFiles(): Plugin {
  return {
    name: 'candy-robot-files',
    configureServer(server) {
      server.middlewares.use('/robot/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/').replace(/^\/+/, '');
        const file = resolve(ROBOT, rel);
        if (file !== ROBOT && !file.startsWith(ROBOT + sep)) { res.statusCode = 403; res.end(); return; }
        try {
          if (!statSync(file).isFile()) throw new Error('not a file');
          res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
          res.end(readFileSync(file));
        } catch { next(); }
      });
    },
    generateBundle() {
      for (const file of listFiles(ROBOT)) {
        this.emitFile({ type: 'asset', fileName: `robot/${relative(ROBOT, file).split(sep).join('/')}`, source: readFileSync(file) });
      }
    },
  };
}

// MuJoCo's WASM bundle must not be pre-bundled by Vite. The repository root is allowed so that the requirements file
// (apps/candy/.kiro) and the hoisted node_modules can be read.
export default defineConfig({
  root: WEB,
  base: './',
  plugins: [robotFiles()],
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  server: { port: 5188, strictPort: true, fs: { allow: [REPO] } },
  preview: { port: 5188, strictPort: true },
  worker: { format: 'es' },
  build: { outDir: resolve(WEB, 'dist'), emptyOutDir: true, target: 'es2022' },
});
