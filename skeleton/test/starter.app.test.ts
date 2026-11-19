// The shipped starter robot (skeleton/starter/app.js) against the real kit: lexicon lint, the three requirement lines,
// and a few short physics trials in this process. Horizons stay under 2 s of simulated time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileRequirement, compileRequirementsFile, lintLexicon, type CompiledRequirement } from '../src/ears/index.js';
import { ModelCache, runTrial } from '../src/sim/index.js';
import type { RobotApp, TrialResult } from '../src/sim/types.js';
import { prepareApp } from '../src/cli/adapters/app-loader.js';
import { SKELETON_DIR } from './support/pack.js';
import { runs } from './support/prop.js';

const STARTER = join(SKELETON_DIR, 'starter');
const cache = new ModelCache();
let app: RobotApp;
let angleLine: CompiledRequirement;
let centreLine: CompiledRequirement;

beforeAll(async () => {
  app = (await prepareApp(join(STARTER, 'app.js'))).app;
  // The starter's lines, with the 3 s window shortened to 1.5 s so that a trial simulates 1.7 s.
  const line = 'WHEN the cart is pushed with up to 30 N for 0.2 s THE robot SHALL keep the pole within 30 deg of upright for 1.5 s';
  const r = compileRequirement(line, app.lexicon, { id: 'T1' });
  if (r.requirement === undefined) throw new Error(r.diagnostics.map((d) => d.message).join('; '));
  angleLine = r.requirement;
  const c = compileRequirement('THE robot SHALL keep the cart within 0.3 m of the centre for 1.5 s', app.lexicon, { id: 'T2' });
  if (c.requirement === undefined) throw new Error(c.diagnostics.map((d) => d.message).join('; '));
  centreLine = c.requirement;
});
afterAll(() => cache.dispose());

const trial = (req: CompiledRequirement, scenario: Record<string, number>, seed: number): Promise<TrialResult> =>
  runTrial(app, req, { app: app.id, reqId: req.id, scenario, seed }, { cache });

describe('the starter robot app.js', () => {
  it('passes the lexicon lint with no error and no warning', () => {
    expect(lintLexicon(app.lexicon)).toEqual([]);
  });

  it('compiles the three lines of the shipped requirements file with no diagnostic', () => {
    const text = readFileSync(join(STARTER, 'requirements.md'), 'utf8');
    const out = compileRequirementsFile(text, app.lexicon);
    expect(out.diagnostics).toEqual([]);
    expect(out.requirements.map((r) => r.id)).toEqual(['1.1', '1.2', '2.1']);
    expect(out.requirements[1]?.space.dims.map((d) => [d.name, d.min, d.max])).toEqual([['push.force', 0, 30]]);
  });

  it('recovers a push of 5 N with a wide margin and loses the pole to a push of 20 N', async () => {
    const small = await trial(angleLine, { 'push.force': 5 }, 1);
    const big = await trial(angleLine, { 'push.force': 20 }, 1);
    expect(small.robustness).toBeGreaterThan(15);
    expect(big.robustness).toBeLessThan(0);
    expect(small.unit).toBe('deg');
  });

  it('keeps the cart near the centre with no push at all', async () => {
    const r = await trial(centreLine, {}, 1);
    expect(r.robustness).toBeGreaterThan(0.1);
    expect(r.unit).toBe('m');
  });

  it('gives a bit-identical trial for the same scenario and seed', async () => {
    await fc.assert(fc.asyncProperty(fc.double({ min: 0, max: 30, noNaN: true }), fc.integer({ min: 0, max: 0xffffffff }), async (force, seed) => {
      const a = await trial(angleLine, { 'push.force': force }, seed);
      const b = await trial(angleLine, { 'push.force': force }, seed);
      expect(b.hash).toBe(a.hash);
      expect(b.robustness).toBe(a.robustness);
    }), runs(15));
  });

  it('never gains margin when the push grows, below the force the motor can answer', async () => {
    await fc.assert(fc.asyncProperty(
      fc.double({ min: 0, max: 14, noNaN: true }), fc.double({ min: 0, max: 14, noNaN: true }), fc.integer({ min: 0, max: 0xffffffff }),
      async (f1, f2, seed) => {
        const [lo, hi] = f1 <= f2 ? [f1, f2] : [f2, f1];
        const a = await trial(angleLine, { 'push.force': lo }, seed);
        const b = await trial(angleLine, { 'push.force': hi }, seed);
        expect(b.robustness).toBeLessThanOrEqual(a.robustness + 1e-9);
      },
    ), runs(15));
  });
});
