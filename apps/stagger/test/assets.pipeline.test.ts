import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetError, downloadInputs, main, makeWriter, runPipeline } from '../scripts/fetch-assets.mjs';
import { PINNED_COMMIT, isAllowedHost } from '../scripts/lib/urls.mjs';
import { LICENSE_TEXT, policyZip, smallMeshes, smallMjcf } from './helpers/assetFixtures';

function stubFetch(opts: { status?: (url: string) => number } = {}) {
  const urls: string[] = [];
  const mjcf = smallMjcf();
  const meshes = smallMeshes();
  const fn = vi.fn(async (url: string) => {
    urls.push(url);
    const status = opts.status?.(url) ?? 200;
    let body: Uint8Array = new Uint8Array();
    if (url.endsWith('g1_12dof.xml')) body = new TextEncoder().encode(mjcf);
    else if (url.endsWith('LICENSE')) body = new TextEncoder().encode(LICENSE_TEXT);
    else if (url.endsWith('motion.pt')) body = policyZip();
    else { const name = decodeURIComponent(url.split('/').pop()!); body = meshes.get(name) ?? new Uint8Array(); }
    return { status, arrayBuffer: async () => body.slice().buffer } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, urls };
}

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'stagger-test-')); dirs.push(d); return d; };

describe('asset pipeline', () => {
  it('writes the scene, MJCF, meshes, policy, licence and SOURCE.json', async () => {
    const s = stubFetch();
    const files = await runPipeline(await downloadInputs(s.fn));
    const names = [...files.keys()];
    for (const n of ['scene.xml', 'g1_12dof.xml', 'policy.bin', 'LICENSE', 'SOURCE.json']) expect(names).toContain(n);
    expect(names.filter((n) => n.endsWith('.hull.stl')).length).toBe(13);
    expect(names.filter((n) => n.endsWith('.vis.stl')).length).toBe(13);
  });
  it('copies LICENSE byte for byte', async () => {
    const files = await runPipeline(await downloadInputs(stubFetch().fn));
    expect(new TextDecoder().decode(files.get('LICENSE'))).toBe(LICENSE_TEXT);
  });
  it('records the commit and upstream paths in SOURCE.json', async () => {
    const files = await runPipeline(await downloadInputs(stubFetch().fn));
    const src = JSON.parse(new TextDecoder().decode(files.get('SOURCE.json')));
    expect(src.commit).toBe(PINNED_COMMIT);
    expect(src.files.find((f: { local: string }) => f.local === 'g1_12dof.xml').upstream)
      .toBe('resources/robots/g1_description/g1_12dof.xml');
    expect(src.files.find((f: { local: string }) => f.local === 'policy.bin').upstream).toBe('deploy/pre_train/g1/motion.pt');
  });
  it('requests only allowed hosts, all at the pinned commit', async () => {
    const s = stubFetch();
    await downloadInputs(s.fn);
    expect(s.urls.length).toBeGreaterThan(10);
    for (const u of s.urls) { expect(isAllowedHost(u)).toBe(true); expect(u).toContain(PINNED_COMMIT); }
  });
  it('exits non-zero and prints the URL and status on a non-200 answer', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await tmp();
    const code = await main({ fetchImpl: stubFetch({ status: (u) => (u.endsWith('LICENSE') ? 503 : 200) }).fn, robotDir: join(dir, 'robot'), log: () => {} });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/LICENSE returned HTTP 503/);
  });
  it('exits non-zero and prints the mesh name when a mesh is missing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await tmp();
    const code = await main({ fetchImpl: stubFetch({ status: (u) => (u.includes('left_knee_mesh') ? 404 : 200) }).fn, robotDir: join(dir, 'robot'), log: () => {} });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]![0])).toContain('left_knee_mesh.STL');
  });
  it('writes nothing outside the robot folder', async () => {
    const dir = await tmp();
    const write = makeWriter(join(dir, 'robot'), join(dir, 'tmp'));
    await expect(write(join(dir, 'elsewhere.txt'), new Uint8Array(1))).rejects.toThrow(AssetError);
    await expect(write(join(dir, 'robot', '..', 'x'), new Uint8Array(1))).rejects.toThrow(/outside/);
    await write(join(dir, 'robot', 'ok.txt'), new Uint8Array(1));
  });
  it('writes the files and reports the folder size when it succeeds', async () => {
    const dir = await tmp();
    const log: string[] = [];
    const code = await main({ fetchImpl: stubFetch().fn, robotDir: join(dir, 'robot'), log: (s) => log.push(s) });
    expect(code).toBe(0);
    expect(log.join('\n')).toMatch(/\d+ bytes/);
    expect(await readdir(join(dir, 'robot'))).toContain('scene.xml');
    expect((await readFile(join(dir, 'robot', 'LICENSE'), 'utf8'))).toBe(LICENSE_TEXT);
  });
});