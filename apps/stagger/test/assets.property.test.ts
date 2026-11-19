import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../scripts/fetch-assets.mjs';
import { buildHull } from '../scripts/lib/hull.mjs';
import { rewriteMjcf } from '../scripts/lib/mjcf.mjs';
import { WEIGHT_SPECS, ZIP_ENTRY_FOR, extractWeights, packPolicy, unpackPolicy } from '../scripts/lib/pack.mjs';
import { buildVisual } from '../scripts/lib/simplify.mjs';
import { hullName, parseBinaryStl, visualName, writeBinaryStl } from '../scripts/lib/stl.mjs';
import { PINNED_COMMIT, isAllowedHost, upstreamUrl } from '../scripts/lib/urls.mjs';
import { readZipEntries, writeZip } from '../scripts/lib/zip.mjs';
import { LICENSE_TEXT, policyZip, smallMeshes, smallMjcf } from './helpers/assetFixtures';

const coord = fc.float({ min: -10, max: 10, noNaN: true }).map((x) => Math.fround(x));
const soup = (min: number, max: number) =>
  fc.array(fc.tuple(coord, coord, coord, coord, coord, coord, coord, coord, coord), { minLength: min, maxLength: max })
    .map((a) => new Float32Array(a.flat()));
const hex40 = fc.stringMatching(/^[0-9a-f]{40}$/);

describe('Feature: stagger-app, Property 1: Download URLs are built from the pinned commit', () => {
  it('contains the commit and path on an allowed host, and rejects other hosts', () => {
    fc.assert(fc.property(hex40, fc.stringMatching(/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){0,3}$/), (c, p) => {
      fc.pre(!p.split('/').includes('..'));
      const u = upstreamUrl(c, p);
      expect(u).toContain(c);
      expect(u.endsWith(p)).toBe(true);
      expect(isAllowedHost(u)).toBe(true);
    }), { numRuns: 100 });
    fc.assert(fc.property(fc.domain(), (d) => {
      fc.pre(d !== 'github.com' && d !== 'raw.githubusercontent.com');
      expect(isAllowedHost(`https://${d}/x`)).toBe(false);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 2: Hull meshes enclose their source meshes', () => {
  it('keeps every source vertex inside every face plane within 1e-6 m', () => {
    fc.assert(fc.property(soup(2, 12), (tris) => {
      let hull: Float32Array;
      try { hull = buildHull(tris, 'rand'); } catch (e) { expect(String(e)).toContain('fewer than 4 non-coplanar'); return; }
      for (let f = 0; f < hull.length; f += 9) {
        const a = [hull[f]!, hull[f + 1]!, hull[f + 2]!], b = [hull[f + 3]!, hull[f + 4]!, hull[f + 5]!], c = [hull[f + 6]!, hull[f + 7]!, hull[f + 8]!];
        const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const len = Math.hypot(n[0]!, n[1]!, n[2]!);
        if (len === 0) continue;
        for (let i = 0; i < tris.length; i += 3) {
          const d = ((tris[i]! - a[0]!) * n[0]! + (tris[i + 1]! - a[1]!) * n[1]! + (tris[i + 2]! - a[2]!) * n[2]!) / len;
          expect(d).toBeLessThanOrEqual(1e-6);
        }
      }
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 3: Visual meshes respect the triangle cap', () => {
  it('returns at most the cap, and the input itself when it already fits', async () => {
    await fc.assert(fc.asyncProperty(soup(1, 60), fc.integer({ min: 1, max: 80 }), async (tris, cap) => {
      const out = await buildVisual(tris, cap);
      expect(out.length / 9).toBeLessThanOrEqual(Math.max(cap, 0) || 1);
      if (tris.length / 9 <= cap) expect(out).toBe(tris);
      else expect(out.length / 9).toBeLessThanOrEqual(cap);
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 4: STL write and parse round trip', () => {
  it('has length 84 + 50 n and parse(write(parse(x))) equals parse(x)', () => {
    fc.assert(fc.property(soup(0, 30), (tris) => {
      const bytes = writeBinaryStl(tris);
      expect(bytes.length).toBe(84 + 50 * (tris.length / 9));
      const once = parseBinaryStl(bytes);
      const twice = parseBinaryStl(writeBinaryStl(once));
      expect(Array.from(twice)).toEqual(Array.from(once));
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 5: Hull and visual file names never collide', () => {
  it('gives no duplicates across both name sets', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[A-Za-z0-9_.]{1,12}$/), { minLength: 1, maxLength: 20 }), (names) => {
      const all = [...names.map(hullName), ...names.map(visualName)];
      expect(new Set(all).size).toBe(all.length);
    }), { numRuns: 100 });
  });
});

/** An MJCF with n links, each with a random mix of visual and collision mesh geoms. */
const mjcfArb = fc.array(fc.record({ vis: fc.boolean(), col: fc.boolean(), prim: fc.boolean() }), { minLength: 1, maxLength: 8 }).map((links) => {
  const names = links.map((_, i) => `m${i}`);
  const bodies = links.map((l, i) => `
      <body name="b${i}" pos="0 0 -0.1">
        <inertial pos="0 0 0" mass="1" diaginertia="0.01 0.01 0.01"/>
        <joint name="j${i}_knee_joint" axis="0 1 0" range="-1 1"/>
        ${l.vis ? `<geom type="mesh" contype="0" conaffinity="0" group="1" density="0" mesh="m${i}"/>` : ''}
        ${l.col ? `<geom type="mesh" rgba="0.1 0.2 0.3 1" mesh="m${i}"/>` : ''}
        ${l.prim ? '<geom size="0.01" rgba="1 1 1 1"/>' : ''}
      </body>`).join('');
  const xml = `<mujoco model="r"><compiler meshdir="meshes/"/><asset>${names.map((n) => `<mesh name="${n}" file="${n}.STL"/>`).join('')}</asset>
    <worldbody><body name="pelvis"><inertial pos="0 0 0" mass="1" diaginertia="1 1 1"/><joint name="floating_base_joint" type="free"/>${bodies}</body></worldbody>
    <actuator>${links.map((_, i) => `<motor name="a${i}" joint="j${i}_knee_joint"/>`).join('')}</actuator></mujoco>`;
  return { xml, links };
});
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const strip = (s: string): string => [...s.matchAll(/<(body|joint|inertial)\b[^>]*>/g)].map((m) => m[0]).join('\n');

describe('Feature: stagger-app, Property 6: MJCF rewrite sets mesh groups and preserves structure', () => {
  it('groups collision at 3 on hulls and visual at 2 without contacts, and keeps bodies, joints, inertials', () => {
    fc.assert(fc.property(mjcfArb, ({ xml, links }) => {
      const out = rewriteMjcf(xml);
      const geoms = [...out.matchAll(/<geom\b[^>]*\/>/g)].map((m) => m[0]).filter((g) => attr(g, 'mesh') !== undefined);
      expect(geoms.filter((g) => attr(g, 'group') === '3').length).toBe(links.filter((l) => l.col).length);
      expect(geoms.filter((g) => attr(g, 'group') === '2').length).toBe(links.filter((l) => l.vis).length);
      for (const g of geoms) {
        if (attr(g, 'group') === '3') expect(attr(g, 'mesh')).toMatch(/_hull$/);
        else { expect(attr(g, 'contype')).toBe('0'); expect(attr(g, 'conaffinity')).toBe('0'); }
      }
      expect(strip(out)).toBe(strip(xml));
      expect([...out.matchAll(/<general\b[^>]*name="(a\d+)"/g)].map((m) => m[1])).toEqual(links.map((_, i) => `a${i}`));
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 7: MJCF rewrite is idempotent', () => {
  it('rewrites its own output to itself', () => {
    fc.assert(fc.property(mjcfArb, ({ xml }) => {
      const once = rewriteMjcf(xml);
      expect(rewriteMjcf(once)).toBe(once);
    }), { numRuns: 100 });
  });
});

/** Fills the eight tensors from 32-bit seeds, with raw bit patterns so NaN payloads, infinities and subnormals appear. */
function tensorsFrom(seeds: number[]): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  WEIGHT_SPECS.forEach((s, k) => {
    const n = s.shape.reduce((a, b) => a * b, 1);
    const u = new Uint32Array(n);
    let x = (seeds[k % seeds.length]! | 0) || 1;
    for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; u[i] = x >>> 0; }
    if (n > 4) { u[0] = 0x7fc00001; u[1] = 0xff800000; u[2] = 0x80000000; u[3] = 0x00000001; }
    out[s.name] = new Float32Array(u.buffer);
  });
  return out;
}
const bits = (a: Float32Array): number[] => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length));

describe('Feature: stagger-app, Property 8: policy.bin pack and unpack round trip', () => {
  it('returns every float32 bit for bit with aligned in-file offsets', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 2 ** 31 - 1 }), { minLength: 1, maxLength: 8 }), hex40, (seeds, commit) => {
      const w = tensorsFrom(seeds);
      const bytes = packPolicy(w, commit);
      const { header, tensors } = unpackPolicy(bytes);
      expect(header.commit).toBe(commit);
      expect(header.gateOrder).toBe('ifgo');
      for (const t of header.tensors) { expect(t.offset % 4).toBe(0); expect(t.offset + t.bytes).toBeLessThanOrEqual(bytes.length); }
      for (const s of WEIGHT_SPECS) expect(bits(tensors[s.name]!)).toEqual(bits(w[s.name]!));
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 9: Zip extraction maps entries to the right tensors', () => {
  it('returns entries 2 to 9 as W1 to bhh, and names the entry that is wrong or absent', () => {
    fc.assert(fc.property(fc.boolean(), fc.integer({ min: 2, max: 9 }), fc.constantFrom('ok', 'short', 'missing'), (deflate, which, mode) => {
      const entry = `policy_lstm_1/data/${which}`;
      const z = readZipEntries(policyZip({ deflate, ...(mode === 'short' ? { shortEntry: entry } : {}), ...(mode === 'missing' ? { drop: entry } : {}) }));
      if (mode === 'ok') {
        const w = extractWeights(z);
        WEIGHT_SPECS.forEach((s, i) => expect(w[s.name]![0]).toBeCloseTo(i + 2, 4));
      } else {
        expect(() => extractWeights(z)).toThrow(entry);
      }
      expect(ZIP_ENTRY_FOR[WEIGHT_SPECS[which - 2]!.name]).toBe(entry);
    }), { numRuns: 100 });
  });
  it('round trips arbitrary entries through the zip writer', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}\/[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }), fc.uint8Array({ maxLength: 200 }), fc.boolean(), (names, data, deflate) => {
      const m = readZipEntries(writeZip(names.map((name) => ({ name, data, deflate }))));
      expect([...m.keys()]).toEqual(names);
      for (const v of m.values()) expect(Array.from(v)).toEqual(Array.from(data));
    }), { numRuns: 100 });
  });
});

describe('Feature: stagger-app, Property 10: The asset pipeline is reproducible', () => {
  it('gives byte-equal output files on two runs', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (scale) => {
      const meshes = smallMeshes();
      for (const [k, v] of meshes) { const t = parseBinaryStl(v); meshes.set(k, writeBinaryStl(t.map((x) => x * scale))); }
      const inputs = () => ({ mjcf: smallMjcf(), meshes, license: new TextEncoder().encode(LICENSE_TEXT), policyZip: policyZip() });
      const a = await runPipeline(inputs(), PINNED_COMMIT);
      const b = await runPipeline(inputs(), PINNED_COMMIT);
      expect([...a.keys()]).toEqual([...b.keys()]);
      for (const [k, v] of a) expect(Buffer.compare(Buffer.from(v), Buffer.from(b.get(k)!)), k).toBe(0);
    }), { numRuns: 5 });
  });
});
