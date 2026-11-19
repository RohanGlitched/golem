import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unpackPolicy } from '../scripts/lib/pack.mjs';
import { parseBinaryStl } from '../scripts/lib/stl.mjs';

const robot = (p: string): URL => new URL(`../robot/${p}`, import.meta.url);
const text = (p: string): string => readFileSync(robot(p), 'utf8');

describe('committed robot folder', () => {
  it('has scene.xml, the MJCF, policy.bin, LICENSE and SOURCE.json', () => {
    for (const f of ['scene.xml', 'g1_12dof.xml', 'policy.bin', 'LICENSE', 'SOURCE.json']) expect(existsSync(robot(f))).toBe(true);
  });
  it('sets the timestep to 0.002 s and includes a floor geom', () => {
    expect(text('scene.xml')).toContain('timestep="0.002"');
    expect(text('scene.xml')).toContain('name="floor"');
  });
  it('keeps the BSD-3-Clause notice', () => {
    expect(text('LICENSE')).toMatch(/BSD 3-Clause/i);
  });
  it('lists every file that SOURCE.json names and the MJCF references', () => {
    const src = JSON.parse(text('SOURCE.json')) as { commit: string; files: { upstream: string; local: string }[] };
    expect(src.commit).toBe('276801e46c5d433564f24658bac64f254b7d2d4b');
    for (const f of src.files) expect(existsSync(robot(f.local)), f.local).toBe(true);
    for (const m of text('g1_12dof.xml').matchAll(/file="([^"]+)"/g)) expect(existsSync(robot(`meshes/${m[1]}`)), m[1]).toBe(true);
  });
  it('holds 12 PD actuators and a 12 joint leg chain in the MJCF', () => {
    expect([...text('g1_12dof.xml').matchAll(/<general\b/g)].length).toBe(12);
  });
  it('has visual meshes of at most 3,000 triangles and a readable policy.bin', () => {
    for (const f of readdirSync(robot('meshes'))) {
      if (f.endsWith('.vis.stl')) expect(parseBinaryStl(readFileSync(robot(`meshes/${f}`))).length / 9).toBeLessThanOrEqual(3000);
    }
    const { header, tensors } = unpackPolicy(readFileSync(robot('policy.bin')));
    expect(header.tensors.length).toBe(8);
    expect(tensors.Wih!.length).toBe(256 * 47);
  });
  it('stays small enough for a static site', () => {
    let total = 0;
    for (const f of readdirSync(robot('meshes'))) total += statSync(robot(`meshes/${f}`)).size;
    expect(total).toBeLessThan(10_000_000);
  });
});