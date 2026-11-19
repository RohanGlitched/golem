import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigError, FIELD_ORDER, parseConfig } from '../config.js';
import { propConfig } from '../../../test/support/prop.js';

const MISSING = Symbol('missing');
const invalid: Record<(typeof FIELD_ORDER)[number], unknown[]> = {
  app: [MISSING, 5, '', null, [], {}],
  requirements: [MISSING, 'x', [1], [''], {}, null],
  studioUrl: [1, null, true, []],
  robot: [1, '', null],
  toolTimeCapS: ['5', 0, -1, null, true],
  searchSeed: [1.5, -1, 2 ** 32, '1', null],
  signalUnits: [1, 'm', [], { a: 1 }, { a: '' }, null],
};
const valid = { app: './a.js', requirements: ['r.md'], studioUrl: 'u', robot: 'r', toolTimeCapS: 5, searchSeed: 1, signalUnits: { a: 'm' } };

describe('Property 4: config validation names the first invalid field', () => {
  // Feature: golem-kit, Property 4: Config validation names the first invalid field
  it('names the path and the first invalid field in the fixed order, whatever extra fields exist', () => {
    const arbBad = fc.subarray([...FIELD_ORDER], { minLength: 1 }).chain((fields) => fc.tuple(...fields.map((f) =>
      fc.constantFrom(...invalid[f]).map((v) => [f, v] as const))));
    const arbExtra = fc.dictionary(fc.stringMatching(/^x_[a-z]{1,6}$/), fc.jsonValue(), { maxKeys: 3 });
    fc.assert(fc.property(arbBad, arbExtra, fc.stringMatching(/^\/[a-z]{1,8}$/), (bad, extra, path) => {
      const o: Record<string, unknown> = { ...extra, ...valid };
      for (const [f, v] of bad) { if (v === MISSING) delete o[f]; else o[f] = v; }
      const first = FIELD_ORDER.find((f) => bad.some(([b]) => b === f)) as string;
      try {
        parseConfig(JSON.stringify(o), path);
        throw new Error('expected a ConfigError');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).field).toBe(first);
        expect((e as ConfigError).message).toContain(path);
        expect((e as ConfigError).message).toContain(`"${first}"`);
      }
    }), propConfig);
  });

  it('unknown fields change nothing for a valid config', () => {
    fc.assert(fc.property(fc.dictionary(fc.stringMatching(/^x_[a-z]{1,6}$/), fc.jsonValue(), { maxKeys: 4 }), (extra) => {
      expect(parseConfig(JSON.stringify({ ...extra, ...valid }), '/c')).toEqual(parseConfig(JSON.stringify(valid), '/c'));
    }), propConfig);
  });
});
