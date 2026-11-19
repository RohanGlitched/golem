import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { newestSourceMtime } from '../../cli/adapters/app-loader.js';
import { createDefaultDeps } from '../../cli/deps.js';
import type { RobotApp } from '../../cli/sibling-types.js';
import { createMcpHarness } from '../../../test/support/mcp-harness.js';
import { tinyApp } from '../../../test/support/tiny-app.js';

describe('the MCP server reloads the app after the controller changed', () => {
  it('keeps the loaded app and its pool while nothing changed', async () => {
    const m = await createMcpHarness();
    m.deps.appChanged = async () => false;
    await m.call('falsify', { reqId: '1.2', budget: 8 });
    await m.call('falsify', { reqId: '1.2', budget: 8 });
    expect(m.spies.createPool).toBe(1);
    expect(m.spies.poolClose).toBe(0);
  });

  it('loads the app again, drops the pool, and runs the next falsify on a new pool made for the new app', async () => {
    const m = await createMcpHarness();
    const made: RobotApp[] = [];
    const baseCreate = m.deps.createPool;
    m.deps.createPool = async (o) => { made.push(o.app); return baseCreate(o); };
    let changed = false;
    m.deps.appChanged = async () => changed;
    const reloaded: RobotApp = { ...tinyApp };
    m.deps.loadApp = async () => reloaded;

    await m.call('falsify', { reqId: '1.2', budget: 8 });
    expect(made).toEqual([tinyApp]);
    changed = true;
    const r = await m.call('falsify', { reqId: '1.2', budget: 8 });
    expect(r.isError).toBe(false);
    expect(m.spies.poolClose).toBe(1);
    expect(made).toHaveLength(2);
    expect(made[1]).toBe(reloaded);
    expect(m.logs.some((l) => l.includes('reloaded'))).toBe(true);
  });

  it('reports a reload that fails instead of answering from the old code, and recovers once the files load', async () => {
    const m = await createMcpHarness();
    let changed = true;
    let broken = true;
    m.deps.appChanged = async () => changed;
    m.deps.loadApp = async () => {
      if (broken) throw new Error('controller/gait.ts:12: unexpected token');
      changed = false;
      return tinyApp;
    };
    const bad = await m.call('falsify', { reqId: '1.2', budget: 8 });
    expect(bad.isError).toBe(true);
    expect(bad.summary).toContain('could not be reloaded');
    expect(bad.summary).toContain('controller/gait.ts:12');
    expect(m.spies.poolRun).toBe(0);
    broken = false;
    const good = await m.call('falsify', { reqId: '1.2', budget: 8 });
    expect(good.isError).toBe(false);
    expect(good.json.reqId).toBe('1.2');
  });
});

describe('default deps notice an edited app', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const makeApp = (): { dir: string; file: string; write(marker: number, mtimeS: number): void } => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-reload-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'controller'));
    const file = join(dir, 'app.ts');
    writeFileSync(join(dir, 'controller', 'gain.ts'), 'export const gain = 1;\n');
    const write = (marker: number, mtimeS: number): void => {
      writeFileSync(join(dir, 'controller', 'gain.ts'), `export const gain = ${marker};\n`);
      utimesSync(join(dir, 'controller', 'gain.ts'), mtimeS, mtimeS);
    };
    writeFileSync(file, "import { gain } from './controller/gain';\nconst app: any = { id: 'reload-test', name: 'r', lexicon: { robotNames: [], predicates: [], perturbations: [] }, gain };\nexport default app;\n");
    utimesSync(file, 1_600_000_000, 1_600_000_000);
    return { dir, file, write };
  };

  it('imports the edited controller after loadApp, and reports a change only when a file is newer than the load', async () => {
    const t = makeApp();
    t.write(1, 1_700_000_000);
    const deps = createDefaultDeps();
    const first = await deps.loadApp(t.file, t.dir);
    expect((first as unknown as { gain: number }).gain).toBe(1);
    expect(await deps.appChanged?.(first)).toBe(false);

    t.write(2, 1_800_000_000);
    expect(await deps.appChanged?.(first)).toBe(true);
    const second = await deps.loadApp(t.file, t.dir);
    expect((second as unknown as { gain: number }).gain).toBe(2);
    expect(second).not.toBe(first);
    expect(await deps.appChanged?.(second)).toBe(false);
    await deps.dispose?.();
  }, 60000);

  it('looks at sources and model files and skips node_modules, caches, tests and build output', async () => {
    const t = makeApp();
    t.write(1, 1_700_000_000);
    const base = await newestSourceMtime(t.dir);
    expect(base).toBe(1_700_000_000 * 1000);
    for (const d of ['node_modules', '.golem', 'dist', 'test']) {
      mkdirSync(join(t.dir, d), { recursive: true });
      writeFileSync(join(t.dir, d, 'x.ts'), 'x');
      utimesSync(join(t.dir, d, 'x.ts'), 1_900_000_000, 1_900_000_000);
    }
    expect(await newestSourceMtime(t.dir)).toBe(base);
    writeFileSync(join(t.dir, 'robot.xml'), '<mujoco/>');
    utimesSync(join(t.dir, 'robot.xml'), 1_800_000_000, 1_800_000_000);
    expect(await newestSourceMtime(t.dir)).toBe(1_800_000_000 * 1000);
  });
});
