import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { ModelCache, compileRequirement, extractCriteria, format, parse, runTrial, tokenize, type CompiledRequirement } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import stagger from '../app';
import { lexicon } from '../lexicon';

const text = readFileSync(new URL('../.kiro/specs/g1-walking/requirements.md', import.meta.url), 'utf8');
const criteria = extractCriteria(text).criteria;

const compile = (line: string): CompiledRequirement => {
  const r = compileRequirement(line, lexicon);
  if (!r.requirement) throw new Error(`${line}\n${r.diagnostics.map((d) => d.message).join('\n')}`);
  return r.requirement;
};

describe('Feature: stagger-app, Property 35: Requirement lines compile and re-compile to the same space', () => {
  it('gives an equal space and equal perturbations after format and re-compile', () => {
    const arb = fc.constantFrom(...criteria).map((c) => ({ c, line: c.text }));
    fc.assert(fc.property(arb, ({ c, line }) => {
      const first = compile(line);
      const ast = parse(tokenize(line).tokens, lexicon.robotNames, line).ast!;
      const again = compile(format(ast));
      expect([c.id, again.space]).toEqual([c.id, first.space]);
      expect([c.id, again.perturbations]).toEqual([c.id, first.perturbations]);
      expect(again.horizon).toBe(first.horizon);
    }), { numRuns: 100 });
  });
});

describe('nominal scenario', () => {
  const cache = new ModelCache();
  afterAll(() => cache.dispose());

  it('gives a positive robustness for every line at 0 N or nominal values (horizon capped at 2 s)', async () => {
    const results: string[] = [];
    for (const c of criteria) {
      const req = compile(c.text);
      const short: CompiledRequirement = { ...req, horizon: Math.min(req.horizon, 2) };
      const scenario = Object.fromEntries(req.space.dims.map((d) => [d.name, d.severity === 'down' ? d.max : d.min]));
      const r = await runTrial(stagger, short, { app: 'stagger', reqId: c.id, scenario, seed: 1 }, { cache });
      results.push(`${c.id}: ${r.robustness.toFixed(4)} ${r.unit}`);
      expect([c.id, r.robustness > 0]).toEqual([c.id, true]);
    }
    console.log(`nominal robustness:\n${results.join('\n')}`);
  });
});
