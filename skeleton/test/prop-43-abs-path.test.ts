import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findAbsolutePaths } from '../scripts/pack-checks/agents.js';
import { propConfig } from './support/prop.js';

const body = fc.stringMatching(/^[a-z0-9._-]{1,8}$/);
const offending = fc.oneof(
  body.map((b) => `/${b}`), body.map((b) => `\\${b}`), body.map((b) => `~/${b}`), body.map((b) => `~${b}`),
  fc.tuple(fc.constantFrom('a', 'C', 'z', 'D'), body).map(([d, b]) => `${d}:\\${b}`),
  fc.tuple(body, body).map(([a, b]) => `${a}/home/${b}`), fc.tuple(body, body).map(([a, b]) => `${a}/Users/${b}`), fc.tuple(body, body).map(([a, b]) => `${a}\\Users\\${b}`),
);
const clean = fc.oneof(body.map((b) => `controller/${b}`), body, fc.constant('**'), body.map((b) => `.kiro/${b}`), body.map((b) => `file://.kiro/${b}`));

/** Puts every string at some depth of an object or array tree. */
function nest(values: string[], shape: number[]): unknown {
  let root: unknown = values;
  shape.forEach((s, i) => { root = s % 3 === 0 ? { [`k${i}`]: root, other: i } : s % 3 === 1 ? [root, i] : { a: { b: root } }; });
  return root;
}

describe('Property 43: absolute path and home directory detector', () => {
  // Feature: golem-kit, Property 43: Absolute path and home directory detector
  it('reports exactly the offending string values, at any depth', () => {
    fc.assert(fc.property(fc.array(offending, { maxLength: 5 }), fc.array(clean, { maxLength: 5 }), fc.array(fc.nat(5), { maxLength: 4 }), (bad, good, shape) => {
      const mixed = [...bad, ...good];
      const found = findAbsolutePaths(nest(mixed, shape));
      expect([...found].sort()).toEqual([...bad].sort());
    }), propConfig);
  });
});
