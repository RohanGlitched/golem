// The first minute of a new user, through the built CLI: `golem init` in an empty project writes the starter cart-pole robot,
// `check` compiles its three lines, and `falsify` finds the breaking one with real MuJoCo. The project has a CommonJS
// package.json, as `npm init -y` writes, so this also covers an ES module app.js in such a package.
// It needs `npm run build` in skeleton/ (it runs dist/cli/main.js) and skips with a message when dist is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SKELETON_DIR } from './support/pack.js';

const MAIN = join(SKELETON_DIR, 'dist', 'cli', 'main.js');
const built = existsSync(MAIN);
if (!built) console.warn('[skip] starter end-to-end: run `npm run build` in skeleton/ first');

const dir = mkdtempSync(join(tmpdir(), 'golem-starter-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const golem = (args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { cwd: dir, encoding: 'utf8', timeout: 240000 });

describe.skipIf(!built)('the starter robot through the built CLI, in an empty project', () => {
  it('init writes the robot, check compiles 3 lines, falsify finds the breaking line and pins it', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"first-minute","version":"1.0.0","type":"commonjs"}\n');

    const init = golem(['init']);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('wrote app.js (starter cart-pole robot)\n');
    expect(init.stdout.trim().split('\n').pop()).toBe('next: npx --no-install golem-spec check');
    for (const f of ['app.js', 'robot/scene.xml', 'README.md', 'golem.config.json', '.kiro/specs/cartpole/requirements.md']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }

    const check = golem(['check']);
    expect(check.status).toBe(0);
    expect(check.stdout).toBe('3 requirements compiled, 0 warnings\n');

    const broken = golem(['falsify', '1.2', '--budget', '24']);
    expect(broken.status).toBe(2);
    expect(broken.stdout).toMatch(/^1\.2  BROKEN  margin -[\d.]+ deg  \d+ trials  push\.force = [\d.]+ N  \(shrunk, seed \d+\)$/m);
    const seeds = JSON.parse(readFileSync(join(dir, '.golem', 'seeds', 'cartpole', '1.2.json'), 'utf8')) as { reqId: string; scenario: Record<string, number> }[];
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.reqId).toBe('1.2');
    // the push that breaks the line is near the 15 N the motor can give, well below the 30 N the line allows
    expect(seeds[0]?.scenario['push.force']).toBeGreaterThan(10);
    expect(seeds[0]?.scenario['push.force']).toBeLessThan(20);

    const held = golem(['falsify', '1.1', '--budget', '12']);
    expect(held.status).toBe(0);
    expect(held.stdout).toMatch(/^1\.1  HELD  closest margin \+[\d.]+ deg/m);
  }, 300000);

  it('a second init changes nothing and says the starter was skipped', () => {
    const app = readFileSync(join(dir, 'app.js'), 'utf8');
    const config = readFileSync(join(dir, 'golem.config.json'), 'utf8');
    const again = golem(['init']);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('skipped starter robot (golem.config.json names an app that exists)');
    expect(readFileSync(join(dir, 'app.js'), 'utf8')).toBe(app);
    expect(readFileSync(join(dir, 'golem.config.json'), 'utf8')).toBe(config);
  });

  it('the gate stays red on 1.2, because the starter has no Expectation table, so 1.2 counts as Expected_Hold', () => {
    const gate = golem(['gate']);
    expect(gate.status).toBe(2);
    expect(gate.stdout).toContain('reproduce: npx golem-spec replay 1.2');
    expect(gate.stdout).toMatch(/gate RED: 1 of 3 requirements is not held/);
  }, 300000);
});

describe('the starter says why its gate is red', () => {
  const text = (f: string): string => readFileSync(join(SKELETON_DIR, 'starter', f), 'utf8');
  const sentence = '1.2 breaks today: the motor gives 15 N. `golem gate` stays red until you change app.js and the motor (a stronger motor and gains that use it), or a person marks 1.2 Expected_Break in an Expectation table.';

  it('has the sentence in the spec intro and in the README, and no Expectation table', () => {
    expect(text('requirements.md')).toContain(sentence);
    expect(text('README.md')).toContain(sentence);
    expect(text('requirements.md')).not.toMatch(/^#+ .*Expectation/m);
    expect(text('requirements.md')).not.toContain('is expected to break');
  });
});
