import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIELD_ORDER, formatConfig, parseConfig, type GolemConfig } from '../config.js';
import { propConfig } from '../../../test/support/prop.js';

export const arbConfig: fc.Arbitrary<GolemConfig> = fc.record({
  app: fc.string({ minLength: 1 }),
  requirements: fc.array(fc.string({ minLength: 1 }), { maxLength: 4 }),
  studioUrl: fc.option(fc.string(), { nil: undefined }),
  robot: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  toolTimeCapS: fc.option(fc.double({ min: 1e-9, max: 1e9, noNaN: true }), { nil: undefined }),
  searchSeed: fc.option(fc.integer({ min: 0, max: 0xffffffff }), { nil: undefined }),
}, { requiredKeys: ['app', 'requirements'] }).map((c) => {
  const out: GolemConfig = { app: c.app, requirements: c.requirements };
  for (const k of ['studioUrl', 'robot', 'toolTimeCapS', 'searchSeed'] as const) if (c[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = c[k];
  return out;
});

describe('Property 3: config write and parse round trip', () => {
  // Feature: golem-kit, Property 3: Config write and parse round trip
  it('parses what it formats and keeps fixed key order, 2-space indent and a trailing newline', () => {
    fc.assert(fc.property(arbConfig, (c) => {
      const text = formatConfig(c);
      expect(parseConfig(text, '/c')).toEqual(c);
      expect(text.endsWith('}\n')).toBe(true);
      expect(text.startsWith('{\n  "app"')).toBe(true);
      const keys = Object.keys(JSON.parse(text) as object);
      expect(keys).toEqual(FIELD_ORDER.filter((k) => keys.includes(k)));
    }), propConfig);
  });

  it('writes the same text whatever the key order of the input', () => {
    fc.assert(fc.property(arbConfig, fc.nat(), (c, n) => {
      const entries = Object.entries(c);
      const rot = entries.slice(n % entries.length).concat(entries.slice(0, n % entries.length));
      expect(formatConfig(Object.fromEntries(rot) as unknown as GolemConfig)).toBe(formatConfig(c));
    }), propConfig);
  });
});
