import { describe, expect, it } from 'vitest';
import { createFakeKiro, createTestDeps, createTestIo, seedTinyProject, APP_DIR } from './test-deps.js';
import { createMemoryFs } from './memory-fs.js';
import { compileTiny, tinyTrace, tinyTrial } from './tiny-app.js';

describe('Tiny_Test_App', () => {
  const [r1] = compileTiny();
  const req = r1 as NonNullable<typeof r1>;

  it('gives the analytic robustness for a known force and seed', () => {
    const spec = { app: 'tiny', reqId: req.id, scenario: { 'push.force': 100 }, seed: 5 };
    const { result } = tinyTrial(req, spec);
    const noise = tinyTrace(spec).signals['height'] as Float64Array;
    const expected = Math.min(...noise.subarray(0));
    expect(result.robustness).toBeCloseTo(expected - 0.4, 12);
    expect(result.unit).toBe('m');
    expect(result.robustness).toBeGreaterThan(0.1);
    expect(result.robustness).toBeLessThan(0.2);
  });

  it('breaks above about 147 N and holds below', () => {
    const run = (f: number) => tinyTrial(req, { app: 'tiny', reqId: req.id, scenario: { 'push.force': f }, seed: 1 }).result.robustness;
    expect(run(140)).toBeGreaterThan(0);
    expect(run(200)).toBeLessThan(0);
  });

  it('is deterministic for equal (scenario, seed) and varies with the seed', () => {
    const a = tinyTrace({ app: 'tiny', reqId: 'x', scenario: { 'push.force': 50 }, seed: 9 });
    const b = tinyTrace({ app: 'tiny', reqId: 'x', scenario: { 'push.force': 50 }, seed: 9 });
    const c = tinyTrace({ app: 'tiny', reqId: 'x', scenario: { 'push.force': 50 }, seed: 10 });
    expect(Buffer.from((a.signals['height'] as Float64Array).buffer).equals(Buffer.from((b.signals['height'] as Float64Array).buffer))).toBe(true);
    expect(a.signals['height']).not.toEqual(c.signals['height']);
  });
});

describe('memory KitFs', () => {
  it('rejects a missing file with error.code ENOENT', async () => {
    const fs = createMemoryFs();
    await expect(fs.readFile('/nope')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renames, lists and removes without complaint about missing files', async () => {
    const fs = createMemoryFs({ '/a/b.txt': 'x' });
    await fs.rename('/a/b.txt', '/a/c.txt');
    expect(await fs.readdir('/a')).toEqual(['c.txt']);
    await fs.remove('/a/c.txt');
    await fs.remove('/a/c.txt');
    expect(fs.list()).toEqual([]);
  });

  it('follows symlinks in realpath and when reading', async () => {
    const fs = createMemoryFs({ '/real/f.txt': 'hello' });
    fs.symlink('/link', '/real');
    expect(await fs.realpath('/link/f.txt')).toBe('/real/f.txt');
    expect(await fs.readFile('/link/f.txt')).toBe('hello');
  });

  it('injects one failure and then recovers', async () => {
    const fs = createMemoryFs();
    await fs.mkdir('/d', { recursive: true });
    fs.failOn('write', 'x.txt');
    await expect(fs.writeFile('/d/x.txt', '1')).rejects.toThrow('injected write failure');
    await fs.writeFile('/d/x.txt', '2');
    expect(fs.text('/d/x.txt')).toBe('2');
  });
});

describe('fake kiro-cli runner', () => {
  const v2 = { name: 't', description: 'd', prompt: 'p', tools: ['write', 'read'], allowedTools: ['read'], toolsSettings: { write: { allowedPaths: ['a/**'] } } };

  it('upgrades a V2 file once and reports the finalized file as skipped with unchanged bytes', async () => {
    const k = createFakeKiro(new Map([['/d/t.json', JSON.stringify(v2)]]));
    const first = await k.run('kiro-cli', ['agent', 'upgrade', '/d', '--no-backup']);
    expect(first).toMatchObject({ code: 0 });
    const after = k.files.get('/d/t.json') as string;
    expect(JSON.parse(after).permissions.rules[0]).toMatchObject({ capability: 'fs_write', effect: 'allow' });
    const second = await k.run('kiro-cli', ['agent', 'upgrade', '/d', '--no-backup']);
    expect((second as { stdout: string }).stdout).toContain('skipped');
    expect(k.files.get('/d/t.json')).toBe(after);
  });

  it('rejects a positional path for validate and accepts --path', async () => {
    const k = createFakeKiro(new Map([['/d/t.json', JSON.stringify({ permissions: { rules: [] } })]]));
    expect(await k.run('kiro-cli', ['agent', 'validate', '/d/t.json'])).toMatchObject({ code: 2 });
    expect(await k.run('kiro-cli', ['agent', 'validate', '--path', '/d/t.json'])).toMatchObject({ code: 0 });
  });

  it("returns 'missing' when kiro-cli is not installed", async () => {
    const k = createFakeKiro();
    k.missing = true;
    expect(await k.run('kiro-cli', ['agent', 'validate', '--path', '/x'])).toBe('missing');
  });
});

describe('test deps', () => {
  it('records pool creation and close, and runs the synthetic trial', async () => {
    const t = createTestDeps();
    seedTinyProject(t.fs);
    const pool = await t.deps.createPool({ app: await t.deps.loadApp(''), appDir: APP_DIR });
    const [req] = compileTiny();
    const [r] = await pool.run([{ app: 'tiny', reqId: (req as NonNullable<typeof req>).id, scenario: { 'push.force': 0 }, seed: 1 }]);
    expect((r as NonNullable<typeof r>).robustness).toBeGreaterThan(0);
    await pool.close();
    await pool.close();
    expect(t.spies).toMatchObject({ createPool: 1, poolClose: 1, loadApp: 1 });
  });

  it('collects stdout and stderr separately', () => {
    const io = createTestIo();
    io.stdout.write('a');
    io.stderr.write('b');
    expect([io.stdoutText(), io.stderrText()]).toEqual(['a', 'b']);
  });
});
