import { compileRequirement, lintLexicon } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { EPISODE_SECONDS } from '../constants';
import { lexicon } from '../lexicon';

const compile = (line: string) => compileRequirement(line, lexicon);
const dims = (line: string) => Object.fromEntries((compile(line).requirement?.space.dims ?? []).map((d) => [d.name, d]));

describe('lexicon', () => {
  it('names the robot, the predicates and the perturbations of the hover app', () => {
    expect(lexicon.robotNames).toEqual(expect.arrayContaining(['drone', 'robot']));
    expect(lexicon.predicates.map((p) => p.phrase)).toEqual([
      'stay within {length} of its hover point', 'keep its tilt below {angle}', 'stay above {length}',
    ]);
    expect(lexicon.perturbations).toHaveLength(4);
    expect(lexicon.episodeSeconds).toBe(EPISODE_SECONDS);
  });
  it('passes the lexicon linter without an error', () => {
    const findings = lintLexicon(lexicon as never);
    expect(findings.filter((f: { severity?: string }) => f.severity === 'error')).toEqual([]);
  });
});

describe('gust', () => {
  const line = 'WHEN a gust of up to 12 N hits it for 0.5 s from any direction THE drone SHALL stay within 0.5 m of its hover point for 4 s';
  it('compiles, and searches force over [0, 12] N and the direction over the full circle', () => {
    expect(compile(line).diagnostics).toEqual([]);
    const d = dims(line);
    expect(d['gust.force']).toMatchObject({ kind: 'force', min: 0, max: 12, severity: 'up' });
    expect(d['gust.angle']).toMatchObject({ kind: 'angle', min: 0, severity: 'none', wrap: true });
    expect(d['gust.angle']!.max).toBeCloseTo(2 * Math.PI, 12);
  });
  it('fixes the duration instead of searching it', () => {
    const r = compile(line).requirement!;
    expect(r.space.dims.map((d) => d.name).sort()).toEqual(['gust.angle', 'gust.force']);
    expect(r.perturbations[0]!.params).toMatchObject({ force: 'gust.force', direction: 'gust.angle', duration: 0.5 });
  });
  it('takes a range between two forces, and a fixed direction', () => {
    expect(dims('WHEN a gust of 5 N to 9 N hits it for 0.5 s from any direction THE drone SHALL stay within 1 m of its hover point')['gust.force']).toMatchObject({ min: 5, max: 9 });
    const fixed = 'WHEN a gust of up to 12 N hits it for 0.5 s from behind THE drone SHALL stay within 1 m of its hover point';
    expect(compile(fixed).diagnostics).toEqual([]);
  });
  it('extends the monitored window by the duration of the gust: horizon = 0.5 s + 4 s', () => {
    expect(compile(line).requirement!.horizon).toBeCloseTo(4.5, 12);
  });
});

describe('battery and lag', () => {
  it('searches the battery ratio over its range, harsher downward', () => {
    const d = dims('WHEN the battery sags to 60% to 100% THE drone SHALL stay above 0.5 m for 4 s');
    expect(d['battery.ratio']).toMatchObject({ kind: 'ratio', min: 0.6, max: 1, severity: 'down' });
  });
  it('searches the lag over [0, 0.3] s', () => {
    const d = dims('WHEN the position estimate lags by up to 0.3 s THE drone SHALL stay within 0.35 m of its hover point for 4 s');
    expect(d['estimate.lag']).toMatchObject({ kind: 'duration', min: 0, max: 0.3, severity: 'up' });
  });
  it('searches the gust and the lag together, with the lag in the slot after the gust duration', () => {
    const r = compile('WHEN a gust of up to 2 N hits it for 0.5 s from any direction while the position estimate lags by up to 0.1 s THE drone SHALL stay within 0.35 m of its hover point for 4 s');
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.space.dims.map((d) => d.name).sort()).toEqual(['estimate.lag', 'gust.angle', 'gust.force']);
    expect(r.requirement!.perturbations[0]!.params).toMatchObject({ duration: 0.5, duration2: 'estimate.lag' });
  });
});

describe('predicates', () => {
  it.each([
    ['stay within 0.25 m of its hover point', 'm'],
    ['keep its tilt below 30 deg', 'deg'],
    ['stay above 0.5 m', 'm'],
  ])('"%s" compiles as a response and measures in %s', (response, unit) => {
    const r = compile(`THE drone SHALL ${response}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.monitor({ t: new Float64Array([0]), signals: { hover_distance: new Float64Array([0]), tilt_deg: new Float64Array([0]), altitude: new Float64Array([1]) }, events: [] }).unit).toBe(unit);
  });
});

describe('errors', () => {
  it('rejects a force without a unit', () => {
    const r = compile('WHEN a gust of up to 12 hits it for 0.5 s from any direction THE drone SHALL stay within 0.5 m of its hover point');
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
  it('rejects an unknown phrase and suggests the closest template', () => {
    const r = compile('WHEN a gust of up to 12 N blows on it for 0.5 s from any direction THE drone SHALL stay within 0.5 m of its hover point');
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message).join('\n')).toMatch(/gust of/);
  });
  it('rejects a robot name the lexicon does not have', () => {
    expect(compile('THE arm SHALL stay above 0.5 m').requirement).toBeUndefined();
  });
});
