import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Text } from '../scripts/lib/hash.mjs';
import { collisionMesh, convexHull, simplify, visualMesh } from '../scripts/lib/mesh.mjs';
import { faceCount, parseBinaryStl, parseObj, weld, writeObj } from '../scripts/lib/obj.mjs';
import { isAllowedHost, pandaUrl } from '../scripts/lib/urls.mjs';
import { COMMIT, cubeObj, tetraStl } from './helpers/assetFixtures';

/** A UV sphere with 2 * seg * (ring - 1) faces. */
export function sphere(seg: number, ring: number, r = 0.05) {
  const pos: number[] = [0, 0, r];
  for (let i = 1; i < ring; i++) {
    const th = (Math.PI * i) / ring;
    for (let j = 0; j < seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      pos.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
    }
  }
  pos.push(0, 0, -r);
  const idx: number[] = [];
  const ringStart = (i: number) => 1 + (i - 1) * seg;
  for (let j = 0; j < seg; j++) idx.push(0, ringStart(1) + j, ringStart(1) + ((j + 1) % seg));
  for (let i = 1; i < ring - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = ringStart(i) + j, b = ringStart(i) + ((j + 1) % seg), c = ringStart(i + 1) + j, d = ringStart(i + 1) + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = pos.length / 3 - 1;
  for (let j = 0; j < seg; j++) idx.push(last, ringStart(ring - 1) + ((j + 1) % seg), ringStart(ring - 1) + j);
  return { pos: new Float32Array(pos), idx: Uint32Array.from(idx) };
}

describe('hash', () => {
  it('matches the known sha256 of "abc"', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(new TextEncoder().encode('abc'))).toBe(sha256('abc'));
  });
  it('hashes text the same with LF and CRLF line endings', () => {
    const enc = new TextEncoder();
    expect(sha256Text(enc.encode('a\r\nb\r\n'))).toBe(sha256Text(enc.encode('a\nb\n')));
  });
});

describe('obj', () => {
  it('parses a quad cube with normals and texture coordinates into 12 triangles and 8 vertices', () => {
    const m = parseObj(cubeObj());
    expect(faceCount(m)).toBe(12);
    expect(m.pos.length / 3).toBe(8);
  });
  it('round-trips through write and parse with 6 decimals', () => {
    const m = sphere(12, 6);
    const text = writeObj(m);
    expect(text).toMatch(/^# golem candy robot mesh\nv /);
    const back = parseObj(text);
    expect(faceCount(back)).toBe(faceCount(m));
    for (let i = 0; i < m.pos.length; i++) expect(back.pos[i]).toBeCloseTo(m.pos[i]!, 5);
    expect(writeObj(back)).toBe(text);
  });
  it('supports negative face indices', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
    expect(Array.from(m.idx)).toEqual([0, 1, 2]);
  });
  it('rejects a face index outside the vertex list', () => {
    expect(() => parseObj('v 0 0 0\nf 1 2 3\n')).toThrow(/outside 1\.\.1/);
  });
  it('parses binary STL and rejects a truncated file', () => {
    expect(faceCount(parseBinaryStl(tetraStl()))).toBe(4);
    expect(() => parseBinaryStl(tetraStl().slice(0, 100))).toThrow(/header says 4 triangles/);
  });
  it('drops degenerate triangles when welding', () => {
    const m = weld(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]), Uint32Array.from([0, 1, 2, 0, 2, 3]));
    expect(faceCount(m)).toBe(1);
  });
});

describe('mesh pipeline', () => {
  it('builds the hull of a cube: 8 vertices, 12 triangles', () => {
    const h = convexHull(parseObj(cubeObj()));
    expect(h.pos.length / 3).toBe(8);
    expect(faceCount(h)).toBe(12);
  });
  it('rejects a flat mesh as a hull input and names the mesh', () => {
    const flat = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nf 1 2 3\nf 2 4 3\n');
    expect(() => convexHull(flat, 'flat.obj')).toThrow(/flat\.obj: fewer than 4 non-coplanar vertices/);
  });
  it('takes a 6400-face sphere through the visual pipeline (at most 3000 faces) and the collision pipeline (at most 200)', async () => {
    const s = sphere(80, 41);
    expect(faceCount(s)).toBeGreaterThan(3000);
    const vis = await visualMesh(s);
    expect(faceCount(vis)).toBeLessThanOrEqual(3000);
    expect(faceCount(vis)).toBeGreaterThan(100);
    const col = await collisionMesh(s, 'sphere');
    expect(faceCount(col)).toBeLessThanOrEqual(200);
    expect(faceCount(col)).toBeGreaterThan(20);
  });
  it('leaves a mesh below the cap unchanged in size', async () => {
    const s = sphere(12, 6);
    expect(faceCount(await simplify(s, 3000))).toBe(faceCount(s));
  });
  it('processes a committed real mesh', async () => {
    const text = readFileSync(new URL('../robot/assets/link5_0.obj', import.meta.url), 'utf8');
    const m = parseObj(text);
    expect(faceCount(await visualMesh(m))).toBeLessThanOrEqual(3000);
    expect(faceCount(await collisionMesh(m, 'link5_0'))).toBeLessThanOrEqual(200);
  });
});

describe('urls', () => {
  it('builds raw.githubusercontent URLs from a 40-hex commit', () => {
    expect(pandaUrl(COMMIT, 'assets/link0.stl')).toBe(
      `https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/${COMMIT}/franka_emika_panda/assets/link0.stl`);
  });
  it('rejects a short commit and a path that climbs out', () => {
    expect(() => pandaUrl('abc', 'LICENSE')).toThrow(/40 lowercase hex/);
    expect(() => pandaUrl(COMMIT, '../x')).toThrow(/plain repository path/);
  });
  it('allows only the two GitHub hosts over https', () => {
    expect(isAllowedHost('https://raw.githubusercontent.com/a')).toBe(true);
    expect(isAllowedHost('http://raw.githubusercontent.com/a')).toBe(false);
    expect(isAllowedHost('https://example.com/a')).toBe(false);
  });
});
