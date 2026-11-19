import { describe, expect, it } from 'vitest';
import { PINNED_COMMIT, isAllowedHost, upstreamUrl } from '../scripts/lib/urls.mjs';
import { readZipEntries, writeZip } from '../scripts/lib/zip.mjs';
import { hullName, parseBinaryStl, visualName, writeBinaryStl } from '../scripts/lib/stl.mjs';
import { tetra } from './helpers/assetFixtures';

describe('urls', () => {
  it('pins a 40-character lowercase hex commit that matches interfaces.md', () => {
    expect(PINNED_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(PINNED_COMMIT).toBe('276801e46c5d433564f24658bac64f254b7d2d4b');
  });
  it('builds a raw.githubusercontent.com URL from the commit and path', () => {
    expect(upstreamUrl(PINNED_COMMIT, 'LICENSE')).toBe(
      `https://raw.githubusercontent.com/unitreerobotics/unitree_rl_gym/${PINNED_COMMIT}/LICENSE`);
  });
  it('rejects a commit that is not 40 lowercase hex characters', () => {
    expect(() => upstreamUrl('main', 'LICENSE')).toThrow(/40 lowercase hex/);
    expect(() => upstreamUrl(PINNED_COMMIT.toUpperCase(), 'LICENSE')).toThrow();
  });
  it('rejects paths that escape the repository', () => {
    expect(() => upstreamUrl(PINNED_COMMIT, '../x')).toThrow();
    expect(() => upstreamUrl(PINNED_COMMIT, '/etc/passwd')).toThrow();
  });
  it('accepts only raw.githubusercontent.com and github.com over https', () => {
    expect(isAllowedHost(upstreamUrl(PINNED_COMMIT, 'a'))).toBe(true);
    expect(isAllowedHost('https://github.com/unitreerobotics/unitree_rl_gym')).toBe(true);
    expect(isAllowedHost('https://evil.example.com/a')).toBe(false);
    expect(isAllowedHost('https://raw.githubusercontent.com.evil.example/a')).toBe(false);
    expect(isAllowedHost('http://github.com/a')).toBe(false);
    expect(isAllowedHost('not a url')).toBe(false);
  });
});

describe('zip', () => {
  it('reads stored and deflate entries', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new TextEncoder().encode('hello hello hello hello hello');
    const entries = readZipEntries(writeZip([{ name: 'a/stored', data: a }, { name: 'b/deflated', data: b, deflate: true }]));
    expect([...entries.keys()]).toEqual(['a/stored', 'b/deflated']);
    expect(Array.from(entries.get('a/stored')!)).toEqual([1, 2, 3, 4]);
    expect(new TextDecoder().decode(entries.get('b/deflated')!)).toBe('hello hello hello hello hello');
  });
  it('rejects a buffer that is not a zip', () => {
    expect(() => readZipEntries(new Uint8Array(40))).toThrow(/central directory/);
  });
});

describe('stl', () => {
  it('writes 84 + 50 * n bytes', () => {
    expect(writeBinaryStl(tetra()).length).toBe(84 + 50 * 4);
  });
  it('parses what it writes', () => {
    const t = tetra(3);
    expect(Array.from(parseBinaryStl(writeBinaryStl(t)))).toEqual(Array.from(t));
  });
  it('rejects a buffer whose header count does not match its length', () => {
    const b = writeBinaryStl(tetra());
    expect(() => parseBinaryStl(b.subarray(0, b.length - 1))).toThrow(/header says 4 triangles/);
  });
  it('gives a hull file and a visual file of the same mesh different names', () => {
    expect(hullName('pelvis.STL')).not.toBe(visualName('pelvis.STL'));
    expect(hullName('pelvis.STL')).toMatch(/\.hull\.stl$/);
    expect(visualName('pelvis.STL')).toMatch(/\.vis\.stl$/);
  });
});