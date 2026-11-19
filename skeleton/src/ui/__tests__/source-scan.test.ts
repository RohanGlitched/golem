import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from '../index.js';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir = UI): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'e2e') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string): string => path.relative(UI, p).replace(/\\/g, '/');
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const importsOf = (src: string): string[] => [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"`;]*?from\s+['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] as string);

/** Module dependency order from the design. Files may import from their own layer or a layer above. */
const LAYER: Record<string, number> = {
  'types.ts': 0,
  'stage/stage-builder.ts': 2, 'stage/clay-material.ts': 2, 'stage/floor.ts': 2, 'ghosts/ghost-state.ts': 2,
  'aura/aura-model.ts': 2, 'aura/aura-summary.ts': 2, 'run/status.ts': 2, 'run/req-key.ts': 2, 'run/pins.ts': 2, 'run/share-hash.ts': 2, 'run/seed-json.ts': 2,
  'ghosts/ghost-shader.ts': 3, 'ghosts/push-arrow.ts': 3, 'aura/aura-view.ts': 3, 'stage/orbit.ts': 3,
  'stage/stage.ts': 4, 'hero/hero-sim.ts': 4, 'hero/load-hero.ts': 4, 'ghosts/ghost-swarm.ts': 4,
  'hero/shove.ts': 5, 'run/recording-pool.ts': 5,
  'run/run-controller.ts': 6, 'run/falsify-adapter.ts': 6, 'run/inline-pool.ts': 6, 'run/studio-pool.ts': 6,
  'mount.ts': 8, 'index.ts': 8, 'worker.ts': 8,
};
function layerOf(file: string): number {
  if (file in LAYER) return LAYER[file] as number;
  if (file.startsWith('core/')) return 1;
  if (/^(tablet|reel|verdict|layout)\//.test(file)) return 7;
  throw new Error(`No layer for ${file}: add it to the dependency order`);
}

describe('source scans of skeleton/src/ui', () => {
  const files = sources();

  it('never calls Math.random', () => {
    for (const f of files) expect(read(f), rel(f)).not.toMatch(/Math\.random\s*\(/);
  });

  it('imports no React in core, stage, hero, ghosts, aura or run', () => {
    for (const f of files.filter((x) => /^(core|stage|hero|ghosts|aura|run)\//.test(rel(x)))) {
      expect(importsOf(read(f)).filter((i) => /^react(-dom)?(\/|$)/.test(i)), rel(f)).toEqual([]);
    }
  });

  it('follows the module dependency order', () => {
    for (const f of files) {
      const me = layerOf(rel(f));
      for (const imp of importsOf(read(f))) {
        if (!imp.startsWith('.')) continue;
        const target = path.resolve(path.dirname(f), imp).replace(/\.js$/, '');
        if (!target.startsWith(UI + path.sep)) continue; // ears, sim: siblings above every layer
        const t = [`${target}.ts`, `${target}.tsx`].find((x) => fs.existsSync(x));
        expect(t, `${rel(f)} imports ${imp}`).toBeDefined();
        expect(layerOf(rel(t!)), `${rel(f)} (layer ${me}) imports ${rel(t!)}`).toBeLessThanOrEqual(me);
      }
    }
  });

  it('makes no network request except for static assets', () => {
    for (const f of files) {
      const s = read(f);
      expect(s, rel(f)).not.toMatch(/\bfetch\s*\(/);
      expect(s, rel(f)).not.toMatch(/XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/);
    }
  });

  it('uses plain three.js and no analytics or trackers', () => {
    for (const f of files) {
      for (const imp of importsOf(read(f))) {
        if (imp.startsWith('.')) continue;
        expect(imp, rel(f)).not.toMatch(/react-three|@react-three|analytics|gtag|mixpanel|posthog|segment|sentry|amplitude|hotjar/i);
        expect(['three', 'react', 'react-dom', '@mujoco/mujoco'].some((p) => imp === p || imp.startsWith(`${p}/`)), `${rel(f)} imports ${imp}`).toBe(true);
      }
    }
  });

  it('exports only the documented API', () => {
    expect(Object.keys(ui).sort()).toEqual(['mountStudio']);
    const idx = read(path.join(UI, 'index.ts'));
    expect(idx).toMatch(/export \{ mountStudio \} from '\.\/mount\.js';/);
    expect(idx).toMatch(/export type \{ StudioOptions, StudioHandle, PerturbationVisual \} from '\.\/types\.js';/);
  });
});
