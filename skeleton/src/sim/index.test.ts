import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sim from './index.js';
import * as pkg from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('sim public exports', () => {
  it('matches the documented export surface exactly', () => {
    expect(Object.keys(sim).sort()).toEqual([
      'DIVERGED_ROBUSTNESS', 'ModelCache', 'PoseRecorder', 'SimError', 'buildContext', 'changedModelFields', 'createSaturationMeter', 'forEachContact', 'geomDistance',
      'liveHandleCount', 'loadMujoco', 'makeTestRequirement', 'mulberry32', 'otherIntegrator', 'readWarnings', 'recheckTrial',
      'runTrial', 'testApp',
      'validateRobotPaths', 'withDoubleBuffer', 'writeRobotFiles',
    ]);
  });
  it('keeps the registry, scope, test seams and fixtures internal', () => {
    for (const name of ['HandleRegistry', 'TrialScope', 'registry', '__setLoadFnForTests', 'withFakeMj']) {
      expect(name in sim).toBe(false);
    }
  });
  it('is re-exported by the package entry', () => {
    expect(pkg.runTrial).toBe(sim.runTrial);
    expect(pkg.testApp).toBe(sim.testApp);
  });
  it('imports nothing from ears, falsify, pool or ui anywhere under sim', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(here).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(here, name), 'utf8');
      if (/from\s+['"]\.\.\/(ears|falsify|pool|ui|cli|mcp)\b/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
