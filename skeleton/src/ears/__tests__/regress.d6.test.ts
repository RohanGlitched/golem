// Regression test for defect 6: a misspelt WHERE feature silently passed, and NaN and Infinity
// both serialised as null.
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import * as ears from '../index.js';
import type { Trace } from '../types.js';
import { g1Lexicon } from './g1Lexicon.js';

const lex = g1Lexicon({ features: ['the payload kit is fitted', 'the arms are locked'] });
const low: Trace = {
  t: Float64Array.from([0, 1]),
  signals: { pelvis_z: Float64Array.from([0.2, 0.2]), tilt_deg: Float64Array.from([0, 0]) },
  events: [],
};

describe('defect 6: WHERE features are checked against the Lexicon', () => {
  it('reports a misspelt feature with the closest declared feature', () => {
    const line = 'WHERE the payload kit is fited, THE golem SHALL stay upright';
    const r = compileRequirement(line, lex);
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect([d.kind, d.severity, line.slice(d.start, d.end), d.suggestion]).toEqual([
      'UNKNOWN_PHRASE', 'error', 'the payload kit is fited', 'the payload kit is fitted',
    ]);
    expect(d.message).toBe(
      `Unknown feature 'the payload kit is fited'. Did you mean "the payload kit is fitted"? Declared features: the payload kit is fitted, the arms are locked`,
    );
  });

  it('reports every WHERE line when the Lexicon declares no features', () => {
    const r = compileRequirement('WHERE the payload kit is fitted THE golem SHALL stay upright', g1Lexicon());
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "The Lexicon declares no features, so 'the payload kit is fitted' cannot match.",
    ]);
  });

  it('keeps a declared feature vacuous until it is enabled, matching case and spaces loosely', () => {
    const line = 'WHERE The Payload  kit is fitted THE golem SHALL stay upright';
    const off = compileRequirement(line, lex).requirement!;
    expect(off.monitor(low)).toEqual({ robustness: Infinity, worstAt: 0, unit: 'm' });
    const on = compileRequirement(line, lex, { enabledFeatures: ['the payload kit is fitted'] }).requirement!;
    expect(on.monitor(low).robustness).toBeCloseTo(-0.3, 12);
  });
});

describe('defect 6: special robustness values serialise distinctly', () => {
  const api = ears as Record<string, unknown>;
  it('encodes NaN, Infinity and -Infinity as distinct strings and decodes them back', () => {
    const encode = api['encodeRobustness'] as (x: number) => number | string;
    const decode = api['decodeRobustness'] as (x: number | string) => number;
    expect(typeof encode).toBe('function');
    expect([NaN, Infinity, -Infinity, 0.25, -0].map(encode)).toEqual(['NaN', 'Infinity', '-Infinity', 0.25, -0]);
    for (const x of [NaN, Infinity, -Infinity, 0.25, -3e-9]) expect(decode(encode(x))).toBe(x);
    expect(() => decode('null')).toThrow(/robustness/);
  });

  it('serialises a monitor result without collapsing to null', () => {
    const toJSON = api['monitorResultToJSON'] as (r: { robustness: number; worstAt: number; unit: string }) => unknown;
    expect(JSON.stringify(toJSON({ robustness: NaN, worstAt: 0, unit: 'trace' }))).toBe('{"robustness":"NaN","worstAt":0,"unit":"trace"}');
    expect(JSON.stringify(toJSON({ robustness: Infinity, worstAt: 0, unit: 'm' }))).toBe('{"robustness":"Infinity","worstAt":0,"unit":"m"}');
  });
});
