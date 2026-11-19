// Writes site/data/lexicon.json: the EARS dialect reference, generated from the apps' lexicons and compiled lines.
// Run from site/: npx vite-node scripts/gen-lexicon.ts   (the `gen` script runs it).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileRequirement, extractCriteria } from 'golem-spec';
import { lexicon as stagger } from '../../apps/stagger/lexicon';
import { lexicon as candy } from '../../apps/candy/lexicon';
import { lexicon as hover } from '../../apps/hover/lexicon';

const root = fileURLToPath(new URL('../../', import.meta.url));
const apps = [
  { app: 'stagger', name: 'Stagger: Unitree G1', lexicon: stagger, spec: 'apps/stagger/.kiro/specs/g1-walking/requirements.md' },
  { app: 'candy', name: 'Candy: Franka Panda', lexicon: candy, spec: 'apps/candy/.kiro/specs/candy-sorter/requirements.md' },
  { app: 'hover', name: 'Hover: Skydio X2', lexicon: hover, spec: 'apps/hover/.kiro/specs/hover-hold/requirements.md' },
];

const out = apps.map((a) => {
  const md = readFileSync(root + a.spec, 'utf8');
  const lines = extractCriteria(md).criteria.map((c: { id: string; text: string }) => {
    const r = compileRequirement(c.text, a.lexicon, { id: c.id });
    if (!r.requirement) throw new Error(`${a.app} ${c.id} does not compile: ${r.diagnostics.map((d: { message: string }) => d.message).join('; ')}`);
    const q = r.requirement;
    return {
      id: c.id, source: c.text, pattern: q.pattern, horizon: q.horizon, ...(q.formula ? { formula: q.formula } : {}),
      dims: q.space.dims.map((d: { name: string; kind: string; min: number; max: number; severity: string; wrap?: boolean }) => ({
        name: d.name, kind: d.kind, min: d.min, max: d.max, severity: d.severity, ...(d.wrap ? { wrap: true } : {}),
      })),
    };
  });
  return {
    app: a.app,
    name: a.name,
    robotNames: [...a.lexicon.robotNames],
    predicates: a.lexicon.predicates.map((p: { phrase: string; unit: string; signals: string[]; slots?: Record<string, unknown> }) => ({
      phrase: p.phrase, unit: p.unit, signals: [...p.signals], slots: Object.keys(p.slots ?? {}),
    })),
    perturbations: a.lexicon.perturbations.map((p: { phrase: string; slots?: Record<string, { dim: string; severity: string }>; maxOnset?: number }) => ({
      phrase: p.phrase, slots: p.slots ?? {}, ...(p.maxOnset !== undefined ? { maxOnset: p.maxOnset } : {}),
    })),
    lines,
  };
});

const file = fileURLToPath(new URL('../data/lexicon.json', import.meta.url));
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${file}: ${out.map((o) => `${o.app} ${o.predicates.length} predicates, ${o.perturbations.length} perturbations, ${o.lines.length} lines`).join('; ')}`);
