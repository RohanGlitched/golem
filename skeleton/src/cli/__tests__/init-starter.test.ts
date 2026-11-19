import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PackError, STARTER_FILES, buildPlan, executePlan, readManifest } from '../init.js';
import { CONFIG_NAME, parseConfig } from '../config.js';
import { createHarness } from '../../../test/support/harness.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';
import { installPack } from '../../../test/support/pack-fixture.js';
import { propConfig } from '../../../test/support/prop.js';

const STARTER: Record<string, string> = {
  'app.js': '// starter app\nexport default {};\n',
  'robot/scene.xml': '<mujoco/>\n',
  'requirements.md': '1. THE robot SHALL keep the cart within 0.3 m of the centre\n',
  'README.md': '# starter\n',
};
const SRC_OF = Object.fromEntries(STARTER_FILES.map((f) => [f.dest, f.src]));
const DESTS = STARTER_FILES.map((f) => f.dest);

/** An empty project with the fixture pack and the fixture starter installed. */
const setup = () => {
  const h = createHarness({ seed: false });
  installPack(h.fs);
  for (const [src, text] of Object.entries(STARTER)) h.fs.put(`/starter/${src}`, text);
  h.deps.starterRoot = '/starter';
  return h;
};
const lines = (h: ReturnType<typeof setup>): string[] => h.io.stdoutText().trim().split('\n');
const starterText = (dest: string): string => STARTER[SRC_OF[dest] as string] as string;

describe('golem init with the starter robot', () => {
  it('writes the starter robot and a config that points at it in an empty project', async () => {
    const h = setup();
    expect(await h.run('init')).toBe(0);
    for (const dest of DESTS) expect(h.fs.text(h.path(dest)), dest).toBe(starterText(dest));
    const config = parseConfig(h.fs.text(h.path(CONFIG_NAME)) as string, CONFIG_NAME);
    expect(config.app).toBe('./app.js');
    expect(config.requirements).toEqual(['.kiro/specs/cartpole/requirements.md']);
    expect(config.robot).toBe('cartpole');
    expect(config.signalUnits).toEqual({ pole_angle: 'rad', cart_x: 'm' });
  });

  it('lists the starter in the output and ends with the next command to run', async () => {
    const h = setup();
    await h.run('init');
    const out = lines(h);
    expect(out).toContain('wrote app.js (starter cart-pole robot)');
    expect(out).toContain('wrote robot/scene.xml');
    expect(out).toContain('wrote .kiro/specs/cartpole/requirements.md');
    expect(out).toContain('wrote golem.config.json');
    expect(out[out.length - 1]).toBe('next: npx --no-install golem-spec check');
  });

  it('writes nothing of the starter and says why when golem.config.json names an app that exists', async () => {
    const h = setup();
    h.fs.put(h.path(CONFIG_NAME), '{"app":"./src/robot.js","requirements":["spec.md"]}\n');
    h.fs.put(h.path('src/robot.js'), 'export default {};');
    expect(await h.run('init')).toBe(0);
    for (const dest of DESTS) expect(h.fs.text(h.path(dest)), dest).toBeUndefined();
    expect(h.fs.text(h.path(CONFIG_NAME))).toBe('{"app":"./src/robot.js","requirements":["spec.md"]}\n');
    expect(lines(h)).toContain('skipped starter robot (golem.config.json names an app that exists)');
    expect(h.io.stdoutText()).not.toContain('next:');
    expect(h.fs.text(h.path('.kiro/hooks/golem.json'))).toBeDefined();
  });

  it('keeps a config that names an app that exists, byte for byte, even with --force', async () => {
    const h = setup();
    const mine = '{"app":"./src/robot.js","requirements":["spec.md"]}\n';
    h.fs.put(h.path(CONFIG_NAME), mine);
    h.fs.put(h.path('src/robot.js'), 'export default {};');
    h.fs.put(h.path('.kiro/hooks/golem.json'), 'old');
    expect(await h.run('init', '--force')).toBe(0);
    expect(h.fs.text(h.path(CONFIG_NAME))).toBe(mine);
    expect(h.fs.text(h.path('.kiro/hooks/golem.json'))).not.toBe('old');
    expect(lines(h)).toContain('skipped golem.config.json (names an app that exists)');
  });

  it('never overwrites an existing app.js, with or without --force', async () => {
    for (const args of [[], ['--force']]) {
      const h = setup();
      h.fs.put(h.path('app.js'), 'export const mine = 1;');
      expect(await h.run('init', ...args)).toBe(0);
      expect(h.fs.text(h.path('app.js'))).toBe('export const mine = 1;');
      expect(h.fs.text(h.path('robot/scene.xml'))).toBeUndefined();
      expect(h.fs.text(h.path('.kiro/specs/cartpole/requirements.md'))).toBeUndefined();
      expect(lines(h)).toContain('skipped starter robot (app.js exists)');
      expect(parseConfig(h.fs.text(h.path(CONFIG_NAME)) as string, CONFIG_NAME).requirements).toEqual(['.kiro/specs/robot/requirements.md']);
    }
  });

  it('never overwrites an existing robot/ directory or an existing cartpole spec', async () => {
    const withRobot = setup();
    withRobot.fs.put(withRobot.path('robot/mine.xml'), '<mine/>');
    expect(await withRobot.run('init', '--force')).toBe(0);
    expect(withRobot.fs.text(withRobot.path('robot/mine.xml'))).toBe('<mine/>');
    expect(withRobot.fs.text(withRobot.path('app.js'))).toBeUndefined();
    expect(lines(withRobot)).toContain('skipped starter robot (robot/ exists)');

    const withSpec = setup();
    withSpec.fs.put(withSpec.path('.kiro/specs/cartpole/requirements.md'), 'mine');
    expect(await withSpec.run('init', '--force')).toBe(0);
    expect(withSpec.fs.text(withSpec.path('.kiro/specs/cartpole/requirements.md'))).toBe('mine');
    expect(withSpec.fs.text(withSpec.path('app.js'))).toBeUndefined();
  });

  it('keeps the project README.md and still writes the rest of the starter', async () => {
    const h = setup();
    h.fs.put(h.path('README.md'), '# my project\n');
    expect(await h.run('init', '--force')).toBe(0);
    expect(h.fs.text(h.path('README.md'))).toBe('# my project\n');
    expect(h.fs.text(h.path('app.js'))).toBe(starterText('app.js'));
    expect(lines(h)).toContain('skipped README.md (exists)');
  });

  it('writes only the pack and the placeholder config with --no-starter', async () => {
    const h = setup();
    expect(await h.run('init', '--no-starter')).toBe(0);
    for (const dest of DESTS) expect(h.fs.text(h.path(dest)), dest).toBeUndefined();
    expect(parseConfig(h.fs.text(h.path(CONFIG_NAME)) as string, CONFIG_NAME).requirements).toEqual(['.kiro/specs/robot/requirements.md']);
    expect(h.io.stdoutText()).not.toContain('starter');
    expect(h.io.stdoutText()).not.toContain('next:');
  });

  it('replaces the empty placeholder config of an earlier init when the starter is written', async () => {
    const h = setup();
    await h.run('init', '--no-starter');
    h.clearOutput();
    expect(await h.run('init')).toBe(0);
    expect(parseConfig(h.fs.text(h.path(CONFIG_NAME)) as string, CONFIG_NAME).app).toBe('./app.js');
    expect(h.fs.text(h.path('robot/scene.xml'))).toBe(starterText('robot/scene.xml'));
    expect(lines(h)).toContain('wrote golem.config.json (replaced the empty placeholder)');
  });

  it('skips every file on a second run and stays silent about next', async () => {
    const h = setup();
    await h.run('init');
    const writes = h.fs.log.length;
    h.clearOutput();
    expect(await h.run('init')).toBe(0);
    expect(h.fs.log.length).toBe(writes);
    const out = lines(h);
    expect(out.every((l) => /^skipped .* \(.+\)$/.test(l))).toBe(true);
    expect(out).toContain('skipped starter robot (golem.config.json names an app that exists)');
  });

  it('writes no starter when the deps carry no starter root', async () => {
    const h = setup();
    delete h.deps.starterRoot;
    expect(await h.run('init')).toBe(0);
    expect(h.fs.text(h.path('app.js'))).toBeUndefined();
    expect(h.io.stdoutText()).not.toContain('starter');
  });

  it('exits 1 naming the starter and writes nothing when a starter file is unreadable', async () => {
    const h = setup();
    h.fs.files.delete('/starter/robot/scene.xml');
    expect(await h.run('init')).toBe(1);
    expect(h.io.stderrText()).toContain('/starter');
    expect(h.io.stderrText()).toContain('robot/scene.xml');
    expect(h.fs.list().filter((p) => p.startsWith('/proj'))).toEqual([]);
  });

  it('exits 1 with nothing written when the specs directory is a symlink that leads outside the target', async () => {
    const h = setup();
    h.fs.put('/elsewhere/x', '');
    h.fs.symlink(h.path('.kiro/specs'), '/elsewhere');
    expect(await h.run('init')).toBe(1);
    expect(h.io.stderrText()).toContain('outside');
    expect(h.fs.text('/elsewhere/cartpole/requirements.md')).toBeUndefined();
    expect(h.fs.text(h.path('app.js'))).toBeUndefined();
  });
});

describe('starter init plan', () => {
  it('plans starter writes before the config and marks only app.js with the starter note', async () => {
    const fs = createMemoryFs();
    const m = installPack(fs);
    const plan = await buildPlan(fs, '/t', m, { force: false, starterRoot: '/starter' });
    const kinds = plan.entries.map((e) => e.kind);
    expect(kinds.lastIndexOf('starter')).toBeLessThan(kinds.indexOf('config'));
    expect(plan.entries.filter((e) => e.note !== undefined).map((e) => e.rel)).toEqual(['app.js']);
    expect(plan.entries.find((e) => e.rel === 'golem.config.json')?.config).toBe('starter');
    expect(plan.starter).toEqual({ root: '/starter' });
  });

  it('plans no starter entries without a starter root', async () => {
    const fs = createMemoryFs();
    const plan = await buildPlan(fs, '/t', installPack(fs), { force: false });
    expect(plan.entries.some((e) => e.kind === 'starter')).toBe(false);
    expect(plan.starter).toBeUndefined();
    expect(plan.entries.find((e) => e.rel === 'golem.config.json')?.config).toBeUndefined();
  });

  it('throws a PackError that names the starter path when a planned file cannot be read', async () => {
    const fs = createMemoryFs();
    const m = installPack(fs);
    const plan = await buildPlan(fs, '/t', m, { force: false, starterRoot: '/nowhere' });
    await expect(executePlan(fs, plan, '/pack', { force: false }, () => undefined)).rejects.toBeInstanceOf(PackError);
    await expect(executePlan(fs, plan, '/pack', { force: false }, () => undefined)).rejects.toThrow('/nowhere');
    await expect(readManifest(fs, '/pack')).resolves.toBeDefined();
  });
});

describe('the shipped starter', () => {
  const root = join(import.meta.dirname, '..', '..', '..', 'starter');

  it('has every file that init copies', () => {
    for (const f of STARTER_FILES) expect(existsSync(join(root, f.src)), f.src).toBe(true);
  });
});

describe('Property: init never changes a starter path that already holds a file', () => {
  it('keeps the bytes of app.js, robot/, the cartpole spec and README.md, whichever exist, with or without --force', async () => {
    const present = fc.record({
      'app.js': fc.boolean(), 'robot/scene.xml': fc.boolean(), '.kiro/specs/cartpole/requirements.md': fc.boolean(), 'README.md': fc.boolean(),
    });
    await fc.assert(fc.asyncProperty(present, fc.boolean(), fc.boolean(), fc.boolean(), async (have, force, noStarter, twice) => {
      const h = setup();
      const mine = new Map<string, string>();
      for (const [rel, yes] of Object.entries(have)) if (yes) { mine.set(rel, `mine ${rel}`); h.fs.put(h.path(rel), `mine ${rel}`); }
      const args = [...(force ? ['--force'] : []), ...(noStarter ? ['--no-starter'] : [])];
      expect(await h.run('init', ...args)).toBe(0);
      if (twice) expect(await h.run('init', ...args)).toBe(0);
      for (const [rel, text] of mine) expect(h.fs.text(h.path(rel)), rel).toBe(text);
      // the starter is all or nothing: apart from README.md, either every file is the starter's or none was written
      const written = DESTS.filter((d) => d !== 'README.md' && !mine.has(d) && h.fs.text(h.path(d)) !== undefined);
      expect([0, DESTS.length - 1]).toContain(written.length);
    }), propConfig);
  });
});
