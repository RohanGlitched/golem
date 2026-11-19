// The asset script with a stubbed network (Requirements 1.7 to 1.12, 15.11).
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssetError, MENAGERIE_COMMIT, SCRIPT_VERSION, checkCurrent, downloadInputs, main, makeWriter, resolveSnippet, runPipeline,
} from '../scripts/fetch-assets.mjs';
import { sha256 } from '../scripts/lib/hash.mjs';
import { isAllowedHost } from '../scripts/lib/urls.mjs';
import { COMMIT, LICENSE_TEXT, stubFetch, stubUpstream } from './helpers/assetFixtures';

const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'candy-assets-')); dirs.push(d); return d; };
afterEach(async () => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(p); else out[p] = sha256(new Uint8Array(await readFile(join(dir, p))));
    }
  };
  await walk('');
  return out;
}

const run = (dir: string, over: Record<string, unknown> = {}) => {
  const stub = stubUpstream();
  const net = stubFetch(stub);
  const logs: string[] = [];
  return { stub, net, logs, go: (argv: string[] = []) => main({ argv, fetchImpl: net.fn, robotDir: dir, log: (s) => logs.push(s), commit: COMMIT, hashes: stub.hashes, ...over }) };
};

describe('asset script constants', () => {
  it('pins the Menagerie commit of interfaces.md as 40 hex characters', () => {
    expect(MENAGERIE_COMMIT).toBe('370c43965323c0944b433b202aac5058b5f907a9');
    expect(MENAGERIE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('pipeline', () => {
  it('writes panda.xml, scene.xml, hull and visual meshes, the licence and SOURCE.json', async () => {
    const stub = stubUpstream();
    const { inputs } = await downloadInputs(stubFetch(stub).fn, { commit: COMMIT, hashes: stub.hashes });
    const files = await runPipeline(inputs, { commit: COMMIT });
    expect([...files.keys()].sort()).toEqual([
      'LICENSE', 'SOURCE.json', 'assets/link0.hull.obj', 'assets/link0_0.obj', 'assets/link7_collision.hull.obj', 'panda.xml', 'scene.xml',
    ]);
  });
  it('copies the licence byte for byte', async () => {
    const stub = stubUpstream();
    const { inputs } = await downloadInputs(stubFetch(stub).fn, { commit: COMMIT, hashes: stub.hashes });
    const files = await runPipeline(inputs, { commit: COMMIT });
    expect(new TextDecoder().decode(files.get('LICENSE'))).toBe(LICENSE_TEXT);
  });
  it('records commit, script version, source hashes and output hashes in SOURCE.json', async () => {
    const stub = stubUpstream();
    const { inputs } = await downloadInputs(stubFetch(stub).fn, { commit: COMMIT, hashes: stub.hashes });
    const files = await runPipeline(inputs, { commit: COMMIT });
    const m = JSON.parse(new TextDecoder().decode(files.get('SOURCE.json')));
    expect(m.commit).toBe(COMMIT);
    expect(m.scriptVersion).toBe(SCRIPT_VERSION);
    expect(m.sources['panda_nohand.xml']).toBe(stub.hashes['panda_nohand.xml']);
    for (const [p, h] of Object.entries(m.outputs as Record<string, string>)) expect(sha256(files.get(p)!)).toBe(h);
    expect(Object.keys(m.outputs)).not.toContain('SOURCE.json');
  });
  it('produces byte-identical files on two runs', async () => {
    const stub = stubUpstream();
    const a = await runPipeline((await downloadInputs(stubFetch(stub).fn, { commit: COMMIT, hashes: stub.hashes })).inputs, { commit: COMMIT });
    const b = await runPipeline((await downloadInputs(stubFetch(stub).fn, { commit: COMMIT, hashes: stub.hashes })).inputs, { commit: COMMIT });
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [k, v] of a) expect(Buffer.from(v).equals(Buffer.from(b.get(k)!))).toBe(true);
  });
  it('requests only allowed hosts, all at the commit', async () => {
    const stub = stubUpstream();
    const net = stubFetch(stub);
    await downloadInputs(net.fn, { commit: COMMIT, hashes: stub.hashes });
    expect(net.urls.length).toBe(stub.files.size);
    for (const u of net.urls) { expect(isAllowedHost(u)).toBe(true); expect(u).toContain(COMMIT); }
  });
});

describe('main', () => {
  it('writes robot/ on the first run and reports "Assets are current." on the second without any network call', async () => {
    const dir = join(await tmp(), 'robot');
    const r = run(dir);
    expect(await r.go()).toBe(0);
    const before = await tree(dir);
    expect(Object.keys(before)).toContain('panda.xml');
    const calls = r.net.urls.length;
    expect(await r.go()).toBe(0);
    expect(r.net.urls.length).toBe(calls);
    expect(r.logs.at(-1)).toBe('Assets are current.');
    expect(await tree(dir)).toEqual(before);
  });
  it('exits non-zero and names the URL, the status and the file path when a download fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(await tmp(), 'robot');
    const stub = stubUpstream();
    const net = stubFetch(stub, { status: (u) => (u.endsWith('link7_collision.obj') ? 503 : 200) });
    const code = await main({ argv: [], fetchImpl: net.fn, robotDir: dir, log: () => {}, commit: COMMIT, hashes: stub.hashes });
    expect(code).toBe(1);
    const msg = String(err.mock.calls[0]![0]);
    expect(msg).toContain('assets/link7_collision.obj');
    expect(msg).toContain('https://raw.githubusercontent.com/');
    expect(msg).toContain('HTTP 503');
    await expect(stat(dir)).rejects.toThrow();   // nothing was written
  });
  it('exits non-zero and names the URL when the network throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(await tmp(), 'robot');
    const code = await main({
      argv: [], robotDir: dir, log: () => {}, commit: COMMIT, hashes: stubUpstream().hashes,
      fetchImpl: (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as typeof fetch,
    });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/panda_nohand\.xml.*https:\/\/raw\.githubusercontent\.com.*ENOTFOUND/);
  });
  it('exits non-zero and prints the path and both hashes on a hash mismatch', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(await tmp(), 'robot');
    const stub = stubUpstream();
    const wrong = { ...stub.hashes, LICENSE: 'f'.repeat(64) };
    const code = await main({ argv: [], fetchImpl: stubFetch(stub).fn, robotDir: dir, log: () => {}, commit: COMMIT, hashes: wrong });
    expect(code).toBe(1);
    const msg = String(err.mock.calls[0]![0]);
    expect(msg).toContain('LICENSE');
    expect(msg).toContain('f'.repeat(64));
    expect(msg).toContain(stub.hashes['LICENSE']!);
    await expect(stat(dir)).rejects.toThrow();
  });
  it('tells the maintainer to run --resolve while the hashes are null', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(await tmp(), 'robot');
    const code = await main({ argv: [], fetchImpl: stubFetch(stubUpstream()).fn, robotDir: dir, log: () => {}, commit: COMMIT, hashes: null });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]![0])).toBe('Run --resolve once and paste the printed commit and hashes into scripts/fetch-assets.mjs.');
  });
  it('leaves earlier valid files unchanged when a later run fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(await tmp(), 'robot');
    const r = run(dir);
    expect(await r.go()).toBe(0);
    const good = await tree(dir);
    await writeFile(join(dir, 'scene.xml'), 'edited by hand');     // robot/ is no longer current
    const failing = stubFetch(r.stub, { status: () => 500 });
    const code = await main({ argv: [], fetchImpl: failing.fn, robotDir: dir, log: () => {}, commit: COMMIT, hashes: r.stub.hashes });
    expect(code).toBe(1);
    const after = await tree(dir);
    expect(after['scene.xml']).toBe(sha256('edited by hand'));
    for (const [p, h] of Object.entries(good)) if (p !== 'scene.xml') expect(after[p], p).toBe(h);
  });
  it('regenerates a hand-edited file on the next run', async () => {
    const dir = join(await tmp(), 'robot');
    const r = run(dir);
    await r.go();
    const good = await tree(dir);
    await writeFile(join(dir, 'scene.xml'), 'edited by hand');
    expect(await r.go()).toBe(0);
    expect(await tree(dir)).toEqual(good);
  });
  it('--resolve prints the hashes and writes nothing under robot/', async () => {
    const dir = join(await tmp(), 'robot');
    const r = run(dir, { hashes: null });
    expect(await r.go(['--resolve'])).toBe(0);
    await expect(stat(dir)).rejects.toThrow();
    const out = r.logs.join('\n');
    expect(out).toContain(`export const MENAGERIE_COMMIT = '${COMMIT}';`);
    for (const [p, h] of Object.entries(r.stub.hashes)) expect(out).toContain(`'${p}': '${h}'`);
  });
  it('--check reports whether robot/ is current and uses no network', async () => {
    const dir = join(await tmp(), 'robot');
    const r = run(dir);
    expect(await r.go(['--check'])).toBe(1);
    expect(r.logs.at(-1)).toMatch(/^Assets are not current: robot\/SOURCE\.json is missing/);
    await r.go();
    const calls = r.net.urls.length;
    expect(await r.go(['--check'])).toBe(0);
    expect(r.logs.at(-1)).toBe('Assets are current.');
    expect(r.net.urls.length).toBe(calls);
  });
  it('treats a manifest from another commit or script version as not current', async () => {
    const dir = join(await tmp(), 'robot');
    await run(dir).go();
    expect((await checkCurrent(dir, COMMIT)).current).toBe(true);
    expect((await checkCurrent(dir, MENAGERIE_COMMIT)).reason).toMatch(/built from commit/);
  });
});

describe('writer', () => {
  it('writes nothing outside the robot folder', async () => {
    const dir = await tmp();
    const write = makeWriter(join(dir, 'robot'));
    await expect(write(join(dir, 'elsewhere.txt'), new Uint8Array(1))).rejects.toThrow(AssetError);
    await expect(write(join(dir, 'robot', '..', 'x'), new Uint8Array(1))).rejects.toThrow(/outside/);
    await write(join(dir, 'robot', 'assets', 'ok.txt'), new Uint8Array(1));
  });
  it('formats the resolve snippet in sorted order', () => {
    const s = resolveSnippet(COMMIT, { b: '2', a: '1' });
    expect(s.indexOf("'a'")).toBeLessThan(s.indexOf("'b'"));
  });
});
