// Feature: candy-app, Property 3: Collision filter table
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { compileRobot } from './helpers/mujoco';

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

type Cls = 'world' | 'arm' | 'cup' | 'candy' | 'hand' | 'decor';
const geomName = (g: number): string => mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, g) ?? '';

/** Class of a collision participant, from the geom name and body. */
function classify(g: number): Cls {
  const name = geomName(g);
  const bodyName = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY.value, model.geom_bodyid[g]) ?? '';
  if (name.startsWith('hand_')) return 'hand';
  if (name === 'cup_collision') return 'cup';
  if (name.startsWith('candy_')) return 'candy';
  if (/^link[0-7]$/.test(bodyName) && model.geom_contype[g] === 2) return 'arm';
  if (name === 'table' || name === 'floor' || name.startsWith('bowl_')) return 'world';
  return 'decor';
}

const ALLOWED = new Set(['world|arm', 'arm|world', 'world|cup', 'cup|world', 'world|candy', 'candy|world', 'cup|candy', 'candy|cup']);

/** MuJoCo's rule: the pair collides when either contype overlaps the other's conaffinity. */
const collides = (a: number, b: number): boolean =>
  (model.geom_contype[a] & model.geom_conaffinity[b]) !== 0 || (model.geom_contype[b] & model.geom_conaffinity[a]) !== 0;

describe('collision filter', () => {
  const geoms = Array.from({ length: model.ngeom }, (_, i) => i);

  it('finds every class in the model', () => {
    const classes = new Set(geoms.map(classify));
    for (const c of ['world', 'arm', 'cup', 'candy', 'hand', 'decor'] as Cls[]) expect(classes.has(c), c).toBe(true);
  });

  it('lets a pair of geoms collide only for world-arm, world-cup, world-candy and cup-candy', () => {
    fc.assert(fc.property(fc.constantFrom(...geoms), fc.constantFrom(...geoms), (a, b) => {
      const ca = classify(a), cb = classify(b);
      const expected = ALLOWED.has(`${ca}|${cb}`);
      expect(collides(a, b), `${geomName(a)} (${ca}) vs ${geomName(b)} (${cb})`).toBe(expected);
    }), { numRuns: 1000 });
  });

  it('lets no hand geom collide with any geom', () => {
    const hands = geoms.filter((g) => classify(g) === 'hand');
    expect(hands.length).toBeGreaterThanOrEqual(2);
    fc.assert(fc.property(fc.constantFrom(...hands), fc.constantFrom(...geoms), (h, g) => {
      expect(collides(h, g)).toBe(false);
    }), { numRuns: 200 });
  });

  it('keeps candies from colliding with each other, with arm links and with the hand', () => {
    const candies = geoms.filter((g) => classify(g) === 'candy');
    expect(candies).toHaveLength(6);
    for (const a of candies) for (const b of geoms) {
      const c = classify(b);
      if (c === 'candy' || c === 'arm' || c === 'hand') expect(collides(a, b)).toBe(false);
    }
  });
});
